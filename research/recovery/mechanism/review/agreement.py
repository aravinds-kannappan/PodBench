"""Score genuine, locally exported annotations. The default empty report contains no estimates."""
import argparse
import csv
import itertools
import json
import math
from collections import Counter
from pathlib import Path

from generate import PUBLIC, REVIEW, RUBRIC, STUDY, json_bytes


def estimate(n, observed, expected, status="measured"):
    if n < 2:
        return {"n": n, "kappa": None, "status": "fewer than two comparable cases"}
    if math.isclose(expected, 1.0):
        return {"n": n, "agreement": observed, "expected_agreement": expected, "kappa": None,
                "status": "undefined: all ratings share a category"}
    return {"n": n, "agreement": observed, "expected_agreement": expected,
            "kappa": (observed - expected) / (1 - expected), "status": status}


def cohen(pairs):
    n = len(pairs)
    if not n:
        return estimate(0, None, None)
    left, right = map(Counter, zip(*pairs))
    expected = sum(count * right[label] for label, count in left.items()) / n**2
    return estimate(n, sum(a == b for a, b in pairs) / n, expected)


def fleiss(items, raters):
    n = len(items)
    if raters < 2:
        return {"n": n, "kappa": None, "status": "fewer than two raters"}
    if not n:
        return estimate(0, None, None)
    pooled = Counter(label for ratings in items for label in ratings)
    observed = sum(sum(k * (k - 1) for k in Counter(item).values()) for item in items) / (n * raters * (raters - 1))
    expected = sum((count / (n * raters)) ** 2 for count in pooled.values())
    return estimate(n, observed, expected)


def read_annotations(paths, kit):
    cases = {c["case_id"] for c in kit["cases"]}
    raters = {}
    for path in paths:
        entry = json.loads(path.read_text())
        if entry.get("schema_version") != 1 or entry.get("kit_id") != kit["kit_id"]:
            raise ValueError(f"{path}: incompatible kit identifier or version")
        rater = entry.get("annotator_id")
        if not isinstance(rater, str) or not rater.strip() or rater.strip() != rater or rater in raters:
            raise ValueError(f"{path}: require a unique, nonempty pseudonymous annotator ID per export")
        ratings = entry.get("ratings")
        if not isinstance(ratings, dict) or set(ratings) - cases:
            raise ValueError(f"{path}: unknown case or invalid ratings")
        raters[rater] = {}
        for case, responses in ratings.items():
            if not isinstance(responses, dict) or set(responses) - RUBRIC.keys() - {"notes"}:
                raise ValueError(f"{path}: invalid fields in {case}")
            row = {}
            for question, answer in responses.items():
                if question == "notes":
                    if not isinstance(answer, str):
                        raise ValueError(f"{path}: invalid notes for {case}")
                elif answer is not None and answer != "":
                    if answer not in RUBRIC[question]["choices"]:
                        raise ValueError(f"{path}: unrecognized rating for {case}/{question}")
                    row[question] = answer
            if row:
                raters[rater][case] = row
    return raters


def summarize(raters, key):
    case_ids = sorted(key)
    active = {f"reader-{i}": ratings for i, (_, ratings) in enumerate(sorted(raters.items()), 1) if ratings}
    report = {"study": STUDY, "status": "awaiting annotations" if not active else "annotations available",
              "case_count": len(key), "active_raters": len(active), "rubric": {}, "confusion": [],
              "disagreements": [], "expert_vs_automated": []}
    if not active:
        return report
    for question in RUBRIC:
        labels = {reader: {case: row[question] for case, row in ratings.items() if question in row}
                  for reader, ratings in active.items()}
        pairwise = []
        for a, b in itertools.combinations(labels, 2):
            shared = sorted(labels[a].keys() & labels[b].keys())
            pairwise.append({"readers": [a, b], **cohen([(labels[a][i], labels[b][i]) for i in shared])})
        complete = [[r[case] for r in labels.values()] for case in case_ids if all(case in r for r in labels.values())]
        report["rubric"][question] = {
            "rating_count": sum(map(len, labels.values())), "available_per_reader": {r: len(x) for r, x in labels.items()},
            "pairwise_cohen": pairwise, "fleiss_complete_panel": fleiss(complete, len(labels))}
    matrix = Counter()
    for reader, ratings in active.items():
        pairs = []
        for case, row in sorted(ratings.items()):
            expert = row.get("failure_label")
            if expert is None:
                continue
            predicted = key[case]
            matrix[expert, predicted] += 1
            pairs.append((expert, predicted))
            if expert != predicted:
                report["disagreements"].append({"case_id": case, "reader": reader, "expert": expert, "automated": predicted})
        report["expert_vs_automated"].append({"reader": reader, **cohen(pairs)})
    report["confusion"] = [{"expert": a, "automated": b, "count": n} for (a, b), n in sorted(matrix.items())]
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exports", nargs="*", type=Path)
    parser.add_argument("--output", required=True, type=Path, help="write the calculated JSON report here")
    args = parser.parse_args()
    kit = json.loads((PUBLIC / "kit.json").read_text())
    with (REVIEW / "sample_key.csv").open(newline="") as stream:
        key = {r["case_id"]: r["failure_label"] for r in csv.DictReader(stream)}
    try:
        report = summarize(read_annotations(args.exports, kit), key)
    except (ValueError, OSError) as exc:
        parser.exit(1, str(exc) + "\n")
    report["kit_id"] = kit["kit_id"]
    args.output.write_bytes(json_bytes(report))
    print(report["status"])


if __name__ == "__main__":
    main()
