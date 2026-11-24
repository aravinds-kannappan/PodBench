"""Export only category-level counts from the pinned JailbreakBench score files."""
import json
import math
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen


REPO = "JailbreakBench/artifacts"
REVISION = "909e68c01d94222b8ad2e397a017e2e12e2adb73"
FILES = {
    "white_box": ["llama-2-7b-chat-hf", "vicuna-13b-v1.5"],
    "transfer": ["gpt-3.5-turbo-1106", "gpt-4-0125-preview"],
}
FIELDS = ["jailbroken", "jailbroken_llama_guard1"]


def summarize(setting, model):
    path = f"attack-artifacts/GCG/{setting}/{model}.json"
    url = f"https://raw.githubusercontent.com/{REPO}/{REVISION}/{path}"
    with urlopen(url, timeout=90) as source:
        archive = json.load(source)
    params = archive["parameters"]
    if (params["model"], params["attack_type"], params["method"]) != (model, setting, "GCG"):
        raise ValueError(f"Unexpected archive metadata in {path}")
    categories = defaultdict(lambda: {key: {"successful": 0, "scored": 0} for key in FIELDS})
    seen = set()
    for record in archive["jailbreaks"]:
        index = record["index"]
        category = record["category"]
        if type(index) is not int or index in seen or not isinstance(category, str) or not category:
            raise ValueError(f"Invalid case identity or category in {path}")
        seen.add(index)
        for key in FIELDS:
            score = record.get(key)
            if score is None:
                continue
            if type(score) is not bool:
                raise ValueError(f"Expected a boolean verdict for {key} in {path}")
            counts = categories[category][key]
            counts["successful"] += int(score)
            counts["scored"] += 1
    # The pinned files report the primary judge's rate and Guard 1's count.
    primary = [group["jailbroken"] for group in categories.values()]
    successful = sum(group["successful"] for group in primary)
    scored = sum(group["scored"] for group in primary)
    legacy = sum(group["jailbroken_llama_guard1"]["successful"] for group in categories.values())
    if not math.isclose(successful / scored, params["attack_success_rate"]) or legacy != params["total_number_of_jailbreaks"]:
        raise ValueError(f"Verdicts disagree with published judge aggregates in {path}")
    return {
        "model": model, "setting": setting, "path": path,
        "evaluation_date": params["evaluation_date"], "cases": len(seen),
        "categories": dict(sorted(categories.items())),
    }


if __name__ == "__main__":
    result = {
        "repository": REPO, "revision": REVISION,
        "models": [summarize(setting, model) for setting, models in FILES.items() for model in models],
    }
    dest = Path(__file__).resolve().parents[1] / "docs" / "published-gcg.json"
    dest.write_text(json.dumps(result, indent=2) + "\n")
