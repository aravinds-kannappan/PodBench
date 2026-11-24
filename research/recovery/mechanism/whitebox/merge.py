"""Merge completed per-checkpoint studies into the published data contract."""
import argparse
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent


def merge(directory):
    models=[]
    for name in ("qwen2.5-0.5b","smollm2-360m"):
        folder=directory/name
        result=json.loads((folder/"readout-summary.json").read_text())
        vocabulary=json.loads((folder/"vocab-lens-summary.json").read_text())
        for restricted, full in zip(result["lens"], vocabulary.pop("layers"), strict=True):
            if restricted["layer"]!=full["layer"]:
                raise ValueError("Lens layer mismatch")
            restricted.update(full)
        result["vocab_lens_validation"]=vocabulary
        result["steering"]=json.loads((folder/"steering.json").read_text())
        result.update(json.loads((folder/"patching.json").read_text()))
        result["artifacts"]={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(folder.iterdir()) if f.suffix in {".jsonl",".npz"}}
        models.append(result)
    return {"schema_version":1,"study":"Exploratory (not preregistered)","models":models}


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory",type=Path,default=HERE/"records")
    p.add_argument("--out",type=Path,default=HERE/"results.json")
    args=p.parse_args()
    args.out.write_text(json.dumps(merge(args.directory),allow_nan=False,indent=2)+"\n")
