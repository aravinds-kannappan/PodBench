"""Supplementary full-vocabulary logit lens from cached residuals; no transformer forwards."""
import argparse
from collections import Counter
import json
from pathlib import Path

import torch
from safetensors import safe_open
from transformers import AutoTokenizer
from contexts import HERE
from features import NAMES
from fetch_weights import verify


@torch.inference_mode()
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache",type=Path,required=True)
    parser.add_argument("--weights",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    torch.set_num_threads(1)
    bundle=torch.load(args.cache,weights_only=True,map_location="cpu")
    name=bundle["model"]
    key=NAMES[name]
    src=args.weights/key
    weight_file=src/"model.safetensors"
    spec=json.loads((HERE/"weights.json").read_text())[key]
    if not verify(weight_file,spec["files"][weight_file.name]):
        raise ValueError("Original safetensors digest differs")
    tokenizer=AutoTokenizer.from_pretrained(src,local_files_only=True)
    cfg=json.loads((src/"config.json").read_text())
    ids=list(bundle["states"])
    states=torch.stack([bundle["states"][k]["residual"] for k in ids])
    n,layers,width=states.shape
    with safe_open(weight_file,framework="pt",device="cpu") as f:
        head=f.get_tensor("lm_head.weight" if "lm_head.weight" in f.keys() else "model.embed_tokens.weight")
        norm=f.get_tensor("model.norm.weight")
    inspect_id=tokenizer.encode("inspect",add_special_tokens=False)[0]
    records=[]
    flat=states.reshape(-1,width)
    for chunk in flat.split(32):
        x=chunk.float()
        x=(x*torch.rsqrt(x.square().mean(-1,keepdim=True)+cfg["rms_norm_eps"])).to(norm.dtype)*norm
        logits=torch.nn.functional.linear(x,head).float()
        probs=logits.softmax(-1)
        values,tokens=probs.max(-1)
        for token,prob,p_inspect in zip(tokens.tolist(),values.tolist(),probs[:,inspect_id].tolist(),strict=True):
            records.append((token,tokenizer.decode([token],clean_up_tokenization_spaces=False),prob,p_inspect))
    first={r["context_sha256"]:r for r in bundle["rows"]}
    row_weights=Counter(r["context_sha256"] for r in bundle["rows"])
    by_layer=[{"tokens":Counter(),"matches":0,"menu":0,"inspect_p":0.} for _ in range(layers)]
    rows=[]
    final_same=0
    max_delta=0.
    for i,k in enumerate(ids):
        v=records[i*layers:(i+1)*layers]
        ref=bundle["states"][k]
        final_same+=int(v[-1][0]==ref["vocab_argmax"])
        max_delta=max(max_delta,abs(v[-1][-1]-ref["inspect_p"]))
        menu_ids={tokenizer.encode(a,add_special_tokens=False)[0] for a in first[k]["menu"]}
        for l,(t,txt,prob,pi) in enumerate(v):
            a=by_layer[l]
            w=row_weights[k]
            a["tokens"][(int(t),txt)]+=w
            a["matches"]+=w*int(t==v[-1][0])
            a["menu"]+=w*int(t in menu_ids)
            a["inspect_p"]+=w*pi
        rows.append({"context_sha256":k,"decisions":row_weights[k],"layers":[
            {"top_token_id":t,"top_token_text":txt,"top_probability":p,"inspect_token_probability":pi} for t,txt,p,pi in v]})
    count=len(bundle["rows"])
    summary={"n_contexts":n,"n_decisions":count,"final_argmax_matches_forward":final_same,
             "max_final_inspect_probability_absolute_difference":max_delta,"layers":[
                {"layer":l,"vocab_final_agreement":v["matches"]/count,"vocab_top_is_menu_token_rate":v["menu"]/count,
                 "mean_vocab_inspect_token_probability":v["inspect_p"]/count,"vocab_top_tokens":[
                  {"id":t,"text":txt,"count":c} for (t,txt),c in v["tokens"].most_common(5)]}
                for l,v in enumerate(by_layer,1)]}
    out=args.output/name
    out.mkdir(parents=True,exist_ok=True)
    (out/"vocab-lens-summary.json").write_text(json.dumps(summary,indent=2)+"\n")
    (out/"vocab-lens.jsonl").write_text("".join(json.dumps(r,ensure_ascii=False,separators=(",",":"))+"\n" for r in rows))
    print(name,layers,count,n,"final argmax matches",final_same,"max inspect drift",max_delta,flush=True)


if __name__=="__main__":
    main()
