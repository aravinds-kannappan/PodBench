"""Cache source residuals and readouts. This stage runs only unmodified original weights."""
import argparse
import hashlib
import json
from pathlib import Path
import torch

from contexts import HERE, archive, examples
from fetch_weights import verify
from original import Original

NAMES = {"qwen2.5-0.5b":"Qwen","smollm2-360m":"HuggingFaceTB"}


def load_original(model, root):
    key = NAMES[model]
    spec = json.loads((HERE / "weights.json").read_text())[key]
    directory = root / key
    for file, info in spec["files"].items():
        if not verify(directory / file, info):
            raise ValueError(f"Missing or corrupted pinned file: {directory/file}")
    return Original(directory)


def key_for(row):
    return hashlib.sha256(json.dumps(row["messages"], separators=(",",":")).encode()).hexdigest()


@torch.inference_mode()
def run(args):
    torch.set_num_threads(args.threads)
    model = load_original(args.model, args.weights)
    rows = examples(archive(args.model))
    states, decoded = {}, {}
    for i,r in enumerate(rows):
        key = key_for(r)
        held_first = r["seed"]==53 and r["turn"]==1
        if key not in states:
            states[key] = model.capture(r["messages"], r["menu"], parts=held_first)
        if held_first and key not in decoded:
            decoded[key] = model.greedy(r["messages"])
        r["context_sha256"] = key
        if (i+1)%40==0:
            print(f"{args.model} cached {i+1}/{len(rows)} decision records",flush=True)
    torch.save({"model":args.model,"rows":rows,"states":states,"decoded":decoded}, args.cache)
    print(f"Saved {len(states)} distinct contexts and {len(decoded)} validation decodes",flush=True)


if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model",choices=NAMES,required=True)
    p.add_argument("--weights",type=Path,required=True)
    p.add_argument("--cache",type=Path,required=True)
    p.add_argument("--threads",type=int,default=1)
    run(p.parse_args())
