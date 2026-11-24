"""Produce readouts from a local feature cache and run the held-out causal comparisons."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import platform
import torch
import transformers

from contexts import HERE
from features import load_original,NAMES
from interventions import patches,steer
from readouts import agreement,linear_probes,readouts


def save(path,obj):
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(obj,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    tmp.replace(path)


class Checkpoints:
    def __init__(self, root, name, cache):
        self.folder=root/name if root else None
        if self.folder:
            self.folder.mkdir(parents=True,exist_ok=True)
            sources=[HERE/"collect.py",HERE/"interventions.py",HERE/"original.py",cache,HERE/"weights.json"]
            stamp={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
            old=self.read("inputs")
            if old is not None and old!=stamp:
                raise ValueError("Checkpoint files were created with different inputs")
            self.write("inputs",stamp)

    def read(self,name):
        file=self.folder/(name+".json") if self.folder else None
        return json.loads(file.read_text()) if file and file.exists() else None

    def write(self,name,obj):
        if self.folder: save(self.folder/(name+".json"),obj)


def lines(path,rows):
    path.write_text("".join(json.dumps(row,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n" for row in rows))


@torch.inference_mode()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache",type=Path,required=True)
    parser.add_argument("--weights",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--stage",choices=["readouts","interventions"],required=True)
    parser.add_argument("--checkpoint-dir",type=Path)
    parser.add_argument("--threads",type=int,default=1)
    args=parser.parse_args()
    torch.set_num_threads(args.threads)
    bundle=torch.load(args.cache,map_location="cpu",weights_only=True)
    name=bundle["model"]
    out=args.output/name
    out.mkdir(parents=True,exist_ok=True)
    if args.stage=="readouts":
        a=agreement(bundle)
        lens,attention,trial=readouts(bundle)
        probes,pred=linear_probes(bundle["rows"],bundle["states"])
        lines(out/"readouts.jsonl",trial)
        lines(out/"predictions.jsonl",pred)
        spec=json.loads((HERE/"weights.json").read_text())[NAMES[name]]
        data={"id":name,"original":spec["repo_id"],"revision":spec["revision"],"weight_sha256":spec["files"]["model.safetensors"]["sha256"],
              "runtime":{"device":"CPU","dtype":"bfloat16","torch":str(torch.__version__),"transformers":transformers.__version__,"python":platform.python_version(),
                         "attention":"eager","threads":args.threads,"chat_template":"native ChatML","greedy_max_tokens":12},
              "n_contexts":len(bundle["rows"]),"unique_contexts":len(bundle["states"]),
              "train_seeds":[11,23,37],"heldout_seed":53,"agreement":a,"probes":probes,"lens":lens,"attention":attention}
        save(out/"readout-summary.json",data)
        print(name,"HF comparison",{k:v for k,v in a.items() if k!="pairs"})
    else:
        net=load_original(name,args.weights)
        checkpoints=Checkpoints(args.checkpoint_dir,name,args.cache)
        steering,episodes=steer(net,bundle,checkpoints)
        lines(out/"steering-episodes.jsonl",episodes)
        save(out/"steering.json",steering)
        patch,rows,checks=patches(net,bundle,checkpoints)
        lines(out/"patches.jsonl",rows)
        save(out/"patching.json",{"patching":patch,"identity_controls":checks})
        print(name,"steering",steering,flush=True)


if __name__=="__main__":
    main()
