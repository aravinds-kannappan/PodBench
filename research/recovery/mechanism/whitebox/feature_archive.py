"""Export original hidden states once; refit or verify every probe with NumPy alone."""
import argparse
import json
from pathlib import Path
import numpy as np
from readouts import fit_probes


def export(cache, destination):
    import torch
    bundle = torch.load(cache, map_location="cpu", weights_only=True)
    rows = bundle["rows"]
    keys = sorted(bundle["states"])
    index = {key: i for i, key in enumerate(keys)}
    # NumPy has no universal native bfloat16 dtype. Preserve the exact bits, without rounding.
    bits = np.stack([bundle["states"][key]["residual"].view(torch.uint16).numpy() for key in keys])
    layers = bits.shape[1]
    arrays = {name: np.array([r[name] for r in rows]) for name in
              ("id", "turn", "seed", "committed", "inspected", "instruction", "task", "menu_order")}
    arrays.update(
        correct_next_action=np.array([r["target"] or "" for r in rows]),
        layer=np.arange(1, layers+1, dtype=np.int16),
        train=np.array([r["seed"]!=53 for r in rows]),
        context_index=np.array([index[r["context_sha256"]] for r in rows], dtype=np.int32),
        context_sha256=np.asarray(keys), residual_bf16_bits=bits.astype("<u2", copy=False),
    )
    if any(a.dtype.hasobject for a in arrays.values()):
        raise ValueError("Archive has a Python object array")
    np.savez_compressed(destination, **arrays)
    print(f"{destination}: {len(rows)} decision labels, shape {bits.shape}, BF16 bit patterns in uint16")


def refit(source, check, output):
    with np.load(source, allow_pickle=False) as a:
        bits = a["residual_bf16_bits"]
        if bits.dtype != np.dtype("<u2") or bits.ndim!=3 or not np.array_equal(a["train"],a["seed"]!=53):
            raise ValueError("Invalid residual shape, dtype or split")
        # Left-shift BF16 to the most significant half of an IEEE 754 float32.
        residual = (bits.astype("<u4") << 16).view("<f4")[a["context_index"]]
        rows = [dict(id=str(i), turn=int(t), seed=int(seed), committed=bool(w), inspected=bool(obs),
                     instruction=str(arm), target=str(y) or None)
                for i,t,seed,w,obs,arm,y in zip(a["id"],a["turn"],a["seed"],a["committed"],
                                                a["inspected"],a["instruction"],a["correct_next_action"],strict=True)]
    scores, _ = fit_probes(rows, residual)
    if check:
        published = json.loads(check.read_text())["probes"]
        if scores != published:
            raise ValueError("Fitted readouts differ from published scores")
        print(f"Matched all {len(scores)} layer/target score rows for {source.parent.name}")
    if output:
        output.write_text(json.dumps(scores,indent=2)+"\n")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest="command",required=True)
    e=commands.add_parser("export")
    e.add_argument("cache",type=Path)
    e.add_argument("destination",type=Path)
    r=commands.add_parser("refit")
    r.add_argument("source",type=Path)
    r.add_argument("--check",type=Path)
    r.add_argument("--output",type=Path)
    args=parser.parse_args()
    if args.command=="export":
        export(args.cache,args.destination)
    else:
        if not args.check and not args.output:
            parser.error("Choose --check or --output for the refit")
        refit(args.source,args.check,args.output)
