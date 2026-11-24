"""Join trace replay, GGUF scores and the two single-decision interventions."""

import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def jsonlines(name):
    return [json.loads(s) for s in (HERE / name).read_text().splitlines()]


def load_csv(path):
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def compact(v):
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def indexed(rows, keys):
    result = {}
    for row in rows:
        k = tuple(row[key] for key in keys)
        if k in result:
            raise ValueError(f"Duplicate row for {k}")
        result[k] = row
    return result


def assemble():
    rows = load_csv(HERE / "trace_decisions.csv")
    scores = indexed(jsonlines("scores-decisions.jsonl"), ("episode_id", "turn"))
    greedy = indexed(jsonlines("scores-greedy.jsonl"), ("episode_id", "turn"))
    forcing = indexed(jsonlines("forcing.jsonl"), ("id", "turn", "policy"))
    if not (len(rows) == len(scores) == len(greedy) and 2 * len(rows) == len(forcing)):
        raise ValueError("Inconsistent coverage across replay, scores and forcing data")
    for row in rows:
        key = (row["id"], int(row["turn"]))
        score = scores[key]
        row["candidates"] = compact(score["candidates"])
        row["top_tokens"] = compact(score["top_tokens"])
        row["menu_entropy_nats"] = score["menu_entropy_nats"]
        row["margin_nats"] = score["margin_nats"]
        row["top_action"] = score["top_action"]
        row["runner_up"] = score["runner_up"]
        row["menu_logmass"] = score["menu_logmass"]
        row["logged_continuation"] = compact(score["logged_continuation"])
        row["greedy_replay"] = compact(greedy[key]["greedy_path"])
        row["submit_logprob"] = score["candidates"]["submit"]["logprob"]
        if row["reply"] != score["reply"]:
            raise ValueError(f"Reply mismatch at {key}")
        for policy in ("evidence", "oracle"):
            arm = forcing[key + (policy,)]
            if arm["forced_action"] != (row["force_" + policy] or None):
                raise ValueError(f"Forcing plan mismatch for {key} {policy}")
            row[policy + "_success"] = compact(arm["passed"]) if arm["eligible"] else ""
    return rows


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys(), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def schema():
    base = json.loads((HERE / "trace_schema.json").read_bytes())
    schema = base["$defs"]["decision"]
    props = schema["properties"]
    for field in ("top_action", "runner_up"):
        props[field] = {"type": "string"}
    for field in ("menu_entropy_nats", "margin_nats", "submit_logprob"):
        props[field] = {"type": "number"}
    for field in ("oracle_success", "evidence_success"):
        props[field] = {"type": ["boolean", "null"]}
    token = {
        "type": "object",
        "required": ["id", "text", "probability"],
        "properties": {
            "id": {"type": "integer"},
            "text": {"type": "string"},
            "probability": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }
    props["menu_logmass"] = {"type": "number"}
    likelihood = {
        "type": "object",
        "required": ["token_ids", "token_logprobs", "logprob"],
        "properties": {
            "token_ids": {"type": "array", "items": {"type": "integer"}},
            "token_logprobs": {"type": "array", "items": {"type": "number"}},
            "logprob": {"type": "number"},
        },
    }
    props["logged_continuation"] = likelihood
    props["greedy_replay"] = {
        "allOf": [
            likelihood,
            {
                "type": "object",
                "required": [
                    "decoded",
                    "matches_reply",
                    "matches_length",
                    "matches_finish",
                ],
                "properties": {
                    "decoded": {"type": "string"},
                    "matches_reply": {"type": "boolean"},
                    "matches_length": {"type": "boolean"},
                    "matches_finish": {"type": "boolean"},
                },
            },
        ]
    }
    props["top_tokens"] = {"type": "array", "items": token}
    props["candidates"] = {
        "type": "object",
        "additionalProperties": {
            "type": "object",
            "required": ["logprob", "menu_probability", "token_ids", "token_logprobs"],
            "properties": {
                "logprob": {"type": "number"},
                "menu_probability": {"type": "number", "minimum": 0, "maximum": 1},
                "token_ids": {"type": "array", "items": {"type": "integer"}},
                "token_logprobs": {"type": "array", "items": {"type": "number"}},
            },
        },
    }
    schema["required"] = list(props)
    base["title"] = "PodBench exploratory decision or episode after CSV type decoding"
    return base


def common_prefixes(rows):
    """Compare policies on the same original decisions for which both interventions exist."""
    cases = {}
    for row in rows:
        for key in ("all", row["model"]):
            counts = cases.setdefault(
                key,
                {
                    "all_prefixes": 0,
                    "both_eligible": 0,
                    "oracle_only_rescue": 0,
                    "evidence_only_rescue": 0,
                    "both_rescue": 0,
                    "neither_rescue": 0,
                },
            )
            counts["all_prefixes"] += 1
            if not row["force_oracle"] or not row["force_evidence"]:
                continue
            counts["both_eligible"] += 1
            oracle, evidence = (
                row[p + "_success"] == "true" for p in ("oracle", "evidence")
            )
            category = {
                (True, True): "both_rescue",
                (True, False): "oracle_only_rescue",
                (False, True): "evidence_only_rescue",
                (False, False): "neither_rescue",
            }
            counts[category[oracle, evidence]] += 1
    return {"study": "Exploratory (not preregistered)", "groups": cases}


if __name__ == "__main__":
    rows = assemble()
    write_csv(HERE / "decisions.csv", rows)
    (HERE / "forcing-paired.json").write_text(
        json.dumps(common_prefixes(rows), indent=2) + "\n"
    )
    actions, tokens = [], []
    for row in rows:
        identity = {"id": row["id"], "turn": int(row["turn"])}
        for name, candidate in json.loads(row["candidates"]).items():
            actions.append(
                dict(
                    **identity,
                    action=name,
                    logprob=candidate["logprob"],
                    menu_probability=candidate["menu_probability"],
                )
            )
        for rank, token in enumerate(json.loads(row["top_tokens"]), 1):
            tokens.append(
                dict(
                    **identity,
                    rank=rank,
                    token_id=token["id"],
                    text=token["text"],
                    probability=token["probability"],
                )
            )
    write_csv(HERE / "action_scores.csv", actions)
    write_csv(HERE / "first_tokens.csv", tokens)
    (HERE / "schema.json").write_text(json.dumps(schema(), indent=2) + "\n")
