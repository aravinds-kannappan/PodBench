"""Paired decision-position patches and held-out, single-injection SQLite rollouts."""
from collections import defaultdict
import json
import torch
from contexts import RecoveryEpisode
from original import change, tensor_of
from readouts import mean
from run import run_episode


def first_contexts(bundle):
    return {(r["task"],r["seed"],r["menu_order"],r["instruction"]):r for r in bundle["rows"] if r["turn"]==1}


def direction(bundle, block):
    first = first_contexts(bundle)
    diffs = []
    for (task, seed, menu, arm), r in first.items():
        if seed != 53 and arm=="baseline":
            other = first[task,seed,menu,"inspect_first"]
            def value(row):
                return bundle["states"][row["context_sha256"]]["residual"][block].float()
            diffs.append(value(other)-value(r))
    return torch.stack(diffs).mean(0).bfloat16(), len(diffs)


def decisions(logits, menu, ids):
    return menu[int(logits[ids].argmax())], int(logits.argmax())


def patches(net, bundle, resume):
    raw=[]
    checks=[]
    first=first_contexts(bundle)
    for (task,seed,order,arm), generic in sorted(first.items()):
        if seed!=53 or arm!="baseline":
            continue
        saved=resume.read(f"patch-{task}-{order}")
        if saved is not None:
            raw.extend(saved["raw"])
            checks.extend(saved["checks"])
            continue
        raw_start, check_start=len(raw),len(checks)
        treated=first[task,seed,order,"inspect_first"]
        menu = generic["menu"]
        action_ids=net.ids(menu)
        ids, cache=net.cached_prefix(generic["messages"])
        dids,dcache=net.cached_prefix(treated["messages"])
        x=net.forward_last(ids,cache)
        acts={}
        registrations=[]
        for i,mods in enumerate(net.modules()):
            for comp,module in zip(("residual","attention","mlp"),mods):
                def capture(_, __, out, key=(i,comp)):
                    acts[key]=tensor_of(out)[0,-1].detach().clone()
                registrations.append((module,capture))
        d=net.forward_last(dids,dcache,registrations)
        source,s_token=decisions(x,menu,action_ids)
        donor,d_token=decisions(d,menu,action_ids)
        source_reply=net.decode(x,cache)
        donor_reply=net.decode(d,dcache)
        assert source_reply==bundle["decoded"][generic["context_sha256"]]
        assert donor_reply==bundle["decoded"][treated["context_sha256"]]
        full_pair=(source_reply.strip() in menu and donor_reply.strip() in menu and source_reply.strip()!=donor_reply.strip())
        xs=action_ids[menu.index(source)]
        xd=action_ids[menu.index(donor)]
        # Unchanged activation replacement checks cache/reset and intervention indexing.
        own={}
        for comp,module in zip(("residual","attention","mlp"),net.modules()[net.block]):
            def save_self(_,__,out):
                own[comp]=tensor_of(out)[0,-1].clone()
            reference=net.forward_last(ids,cache,[(module,save_self)])
            identity=net.forward_last(ids,cache,[(module,change(own[comp]))])
            drift=float((identity-reference).abs().max())
            if drift!=0: raise ValueError(f"Identity patch changed logits by {drift}")
            checks.append({"task":task,"menu_order":order,"component":comp,"layer":net.block+1,"max_abs_logit_difference":drift})
        for i,mods in enumerate(net.modules()):
            for comp,module in zip(("residual","attention","mlp"),mods):
                y=net.forward_last(ids,cache,[(module,change(acts[i,comp]))])
                top,y_token=decisions(y,menu,action_ids)
                raw.append({"task":task,"menu_order":order,"seed":53,"layer":i+1,"component":comp,
                            "generic_top_action_token":source,"donor_top_action_token":donor,"patched_top_action_token":top,
                            "generic_vocab_token":s_token,"donor_vocab_token":d_token,"patched_vocab_token":y_token,
                            "delta_margin":float((y[xd]-y[xs])-(x[xd]-x[xs])) if xs!=xd else None,
                            "generic_reply":source_reply,"donor_reply":donor_reply,"full_pair":full_pair,
                            "patched_reply":net.decode(y,cache) if full_pair else None})
        resume.write(f"patch-{task}-{order}", {"raw":raw[raw_start:],"checks":checks[check_start:]})
        print("Patched",bundle["model"],task,order,flush=True)
    groups=defaultdict(list)
    for r in raw: groups[r["layer"],r["component"]].append(r)
    summary=[]
    for (layer,comp),rows in sorted(groups.items()):
        changed=[r for r in rows if r["delta_margin"] is not None]
        full=[r for r in rows if r["full_pair"]]
        summary.append({"layer":layer,"component":comp,"n":len(rows),"discordant_leaders":len(changed),
                        "moved_to_donor":sum(r["donor_top_action_token"]==r["patched_top_action_token"] for r in changed),
                        "mean_delta_margin":mean([r["delta_margin"] for r in changed]),
                        "vocab_argmax_changes":sum(r["generic_vocab_token"]!=r["patched_vocab_token"] for r in rows),
                        "full_reply_pairs":len(full),
                        "moved_to_donor_action":sum(r["patched_reply"].strip()==r["donor_reply"].strip() for r in full)})
    return summary,raw,checks


def steer(net,bundle,resume):
    vector,n=direction(bundle,net.block)
    response_cache = {}
    class Policy:
        def __init__(self, coefficient):
            self.coefficient=coefficient

        def complete(self,messages):
            dose=self.coefficient if len(messages)==2 else 0
            perturb=vector*dose if dose else None
            key = (json.dumps(messages, separators=(",",":")), dose)
            if key not in response_cache:
                reply=net.greedy(messages,perturb)
                response_cache[key] = {"text":reply,"input_tokens":net.encode(messages)[0].shape[-1],
                                       "output_tokens":net.last_count,"finish_reason":net.last_finish}
            return response_cache[key]
    episodes=[]
    summary=[]
    for dose in (-1,0,0.5,1,2):
        group=[]
        arm={-1:"negative",0:"control",0.5:"half",1:"steered",2:"double"}[dose]
        for task in ("refund","inventory","transfer"):
            for order in ("canonical","reversed"):
                for world in (False,True):
                    cell=f"steer-{dose}-{task}-{order}-{world}"
                    cached=resume.read(cell)
                    if cached is not None:
                        group.append(cached)
                        continue
                    r=run_episode(bundle["model"],Policy(dose),task,53,world,"baseline",order)
                    if r["status"]=="inference_error": raise ValueError(r["error"])
                    r["steering"]=arm
                    r["coefficient"]=dose
                    r["id"]+="."+arm
                    group.append(r)
                    resume.write(cell,r)
        episodes+=group
        summary.append({"arm":arm,"coefficient":dose,"n":len(group),"layer":net.block+1,"direction_norm":float(vector.float().norm()),
                        "direction_pairs":n,"inspect_first":sum(r["steps"][0]["action"]=="inspect" for r in group),
                        "submitted":sum(r["verdict"]["submitted"] for r in group),
                        "exact_state":sum(all(r["verdict"]["endpoints"].values()) for r in group),
                        "passed":sum(r["verdict"]["passed"] for r in group)})
    by_cell = {(r["task"],r["menu_order"],r["committed"],r["coefficient"]):r for r in episodes}
    def outcomes(r):
        return {"inspect_first":r["steps"][0]["action"]=="inspect","submitted":r["verdict"]["submitted"],
                "exact_state":all(r["verdict"]["endpoints"].values()),"passed":r["verdict"]["passed"]}
    for d in summary:
        pairs=[(by_cell[t,o,w,0],r) for (t,o,w,k),r in by_cell.items() if k==d["coefficient"]]
        d["first_action_changed"]=sum(a["steps"][0]["action"]!=b["steps"][0]["action"] for a,b in pairs)
        d["unparsed_first"]=sum(b["steps"][0]["action"] is None for a,b in pairs)
        d["paired_outcomes"]={}
        for outcome in ("inspect_first","submitted","exact_state","passed"):
            transitions=[(outcomes(a)[outcome],outcomes(b)[outcome]) for a,b in pairs]
            d["paired_outcomes"][outcome]={"gained":transitions.count((False,True)),"lost":transitions.count((True,False))}
    return summary,episodes
