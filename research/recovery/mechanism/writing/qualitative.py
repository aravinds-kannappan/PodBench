"""Checks for empirical findings stated in prose, including statements without numerals."""
from itertools import groupby
import json
import subprocess
import sys
from pathlib import Path


def qualitative_checks(reader, evidence, records):
    frozen="research/recovery/episodes.jsonl"
    source="docs/recovery-results.json"
    manifest="research/recovery/manifest.json"
    trace="research/recovery/mechanism/trace_episodes.csv"
    score="research/recovery/mechanism/scores-summary.json"
    outcomes, _=reader(source)
    journal, _=reader(frozen)
    m, _=reader(manifest)
    rows=outcomes["episodes"]
    result=[]

    def record(key, text, inputs, test, stage="Frozen"):
        if not test:
            raise ValueError(f"Evidence no longer supports qualitative claim: {key}")
        result.append({"id":key,"claim":text,"status":"verified","stage":stage,
                       "source_fields":[{"file":f,"field":k,"sha256":reader(f)[1],"url":evidence(f)} for f,k in inputs]})

    root = Path(__file__).resolve().parents[4]
    baseline_path = "research/recovery/baselines.py"
    controls = [json.loads(line) for line in subprocess.check_output(
        [sys.executable, str(root / baseline_path), "--json"], text=True).splitlines()]
    policy_pass = lambda policy, world: [r["verdict"]["passed"] for r in controls
                                          if r["policy"] == policy and r["committed"] == world]
    record("reference-controls","State-inspecting reference succeeds in both worlds; blind retry and assume-committed succeed in opposite worlds.",
           [(baseline_path,"--json policy, committed, verdict.passed"),(manifest,"tasks, seeds")],
           all(policy_pass("inspect-first",w) and all(policy_pass("inspect-first",w)) and
               all(v == (not w) for v in policy_pass("always-retry",w)) and
               all(v == w for v in policy_pass("assume-committed",w)) for w in (True,False)))
    record("complete-coverage","All scheduled cells have recorded episodes without inference errors.",
           [(source,"totals.scheduled, recorded, inference_errors, missing")],
           outcomes["totals"]["recorded"]==outcomes["totals"]["scheduled"] and
           outcomes["totals"]["missing"]==outcomes["totals"]["inference_errors"]==0)
    pair_key=lambda r:(r["model"],r["task"],r["seed"],r["instruction"],r["menu_order"])
    pairs=[list(grp) for _,grp in groupby(sorted(journal,key=pair_key),key=pair_key)]
    record("matched-openings","Committed and rolled-back worlds in each pair have identical initial visible messages and first replies.",
           [(frozen,"group by model, task, seed, instruction, menu_order; compare committed, prompt, system, menu, steps[0].reply")],
           all(len(p)==2 and {r["committed"] for r in p}=={True,False} and
               all(p[0][k]==p[1][k] for k in ("prompt","system","menu")) and
               p[0]["steps"][0]["reply"]==p[1]["steps"][0]["reply"] for p in pairs))
    record("primary-floor","No checkpoint submitted an exact database in any condition. The paired fixture bootstrap consequently has no width.",
           [(source,"episodes[*].passed; by_model[*].difference, interval")],
           not any(r["passed"] for r in rows) and all(r["difference"]==0 and r["interval"]==[0,0] for r in outcomes["by_model"]))
    av={r["model"]:r["by_instruction"] for r in outcomes["by_model"]}
    def direction(model):
        return av[model]["inspect_first"]["first_inspection"]-av[model]["baseline"]["first_inspection"]
    record("opposite-inspection-directions","First-action inspection increased for Qwen and decreased for SmolLM2 under verify-first.",
           [(source,"by_model[*].by_instruction.{baseline,inspect_first}.first_inspection")],
           direction("qwen2.5-0.5b")>0 and direction("smollm2-360m")<0)
    selected=[r for r in rows if r["exact_state"]]
    record("unacknowledged-refunds","All exact databases came from unsubmitted SmolLM2 committed-refund episodes with canonical menus and repeated status updates.",
           [(source,"episodes[*].{exact_state,submitted,model,task,committed,menu_order,turns[*].action}")],
           bool(selected) and all(not r["submitted"] and r["model"]=="smollm2-360m" and r["task"]=="refund" and r["committed"]
           and r["menu_order"]=="canonical" and [s["action"] for s in r["turns"]]==["mark_refunded"]*m["max_steps"] for r in selected))
    def actions(i):
        return [r["action"] for r in journal[i-1]["steps"]]
    record("inventory-reminder","For the selected rolled-back Qwen inventory case, generic submitted immediately. Verify-first inspected, received stock and submitted without posting the receipt.",
           [(frozen,"lines 27,70: steps[*].action, verdict.endpoints.receipt_posted")],
           actions(70)==["submit"] and actions(27)==["inspect","receive_stock","submit"] and
           not journal[26]["verdict"]["endpoints"]["receipt_posted"])
    record("receipt-phrase","The selected SmolLM2 verify-first case repeated the literal unaccepted reply ‘post the receipt’ on every turn. Its generic counterpart repeatedly inspected.",
           [(frozen,"lines 116,158: menu, steps[*].{reply,valid,action}")],
           "close_receipt" in journal[157]["menu"] and
           all(s["reply"]=="post the receipt" and not s["valid"] for s in journal[157]["steps"])
           and actions(116)==["inspect"]*m["max_steps"])
    t,_=reader(trace)
    bad=[r for r in t if r["first_unreachable_submission"]=="1"]
    record("early-unreachability","Early loss of every legal submission route included both immediate submission and overapplied writes.",
           [(trace,"first_unreachable_submission=1; first_action, failure_label")],
           any(r["first_action"]=="submit" for r in bad) and any(r["failure_label"]=="duplicate write" for r in bad),"Exploratory")
    record("precedence","The exclusive premature-submit label counts fewer episodes than submitted-inexact because some submissions already have a duplicate-write label.",
           [(source,"totals.submitted_inexact"),(trace,"submitted, exact_and_submitted, failure_label")],
           sum(r["failure_label"]=="premature submit" for r in t)<outcomes["totals"]["submitted_inexact"] and
           any(r["failure_label"]=="duplicate write" and r["submitted"]=="true" for r in t),"Exploratory")
    if "scores_completed" in records:
        scored,_=reader(score)
        eligible=[r["post_inspect"] for r in scored["conditions"] if r["post_inspect"]["n"]]
        record("distribution-vs-choice","Opposite-world inspection feedback can alter relative candidate scores on prefixes without changing every highest-ranked candidate.",
               [(score,"conditions[*].post_inspect.{n,top_flips,mean_tv}")],
               any(c["mean_tv"]>0 and c["top_flips"]<c["n"] for c in eligible),"Exploratory")
        warm="research/recovery/mechanism/scores-warm-controls.json"
        qa="research/recovery/mechanism/scores-numerics.json"
        inputs,_=reader(warm)
        checks,_=reader(qa)
        repeat=inputs["repeat_controls"]["smollm2-360m"]["identical_observed_and_swapped_inputs"]["mean_tv"]
        swap=inputs["superseded_swap_summaries"]["smollm2-360m"]["baseline"]["mean_tv"]
        record("numerical-repeatability","With warm prefix reuse, SmolLM2 repeated identical inputs varied more than the initial mean generic observation-swap contrast. Fresh-context repeat controls reduced that discrepancy.",
             [(warm,"SmolLM2 repeat_controls and superseded_swap_summaries.baseline mean_tv"),
              (qa,"smollm2-360m.identical_observed_and_swapped_inputs.max_tv")],
             repeat>swap and checks["smollm2-360m"]["identical_observed_and_swapped_inputs"]["max_tv"]<repeat,"Exploratory")
    black="research/recovery/mechanism/blackbox/results.json"
    if "bb_refund_exact" in records:
        panel,_=reader(black)
        [refund]=[r for r in panel["permutation_summaries"] if r["task"]=="refund" and r["first_menu_entry"]=="all"]
        checkpoint=refund["model"]
        tracefile="research/recovery/mechanism/blackbox/traces.jsonl"
        winners=[r for r in reader(tracefile)[0] if r["family"]=="permutation" and r["passed"]]
        record("successful-menu-trajectories",
               "The successful menu permutations contain the documented status-update and order-transfer paths.",
               [(tracefile,r["id"]+" / steps[*].action and passed") for r in winners],
               sorted(tuple(st["action"] for st in r["steps"]) for r in winners)
               ==sorted([("mark_refunded","submit"),("mark_refunded","mark_refunded","submit"),
                         ("move_orders","remove_customer","move_orders","submit")]),"Exploratory")

        record("menu-permutation-recovery","The exhaustive menu sweep produced a verified recovery for the committed refund while every recorded frozen menu setting failed.",
               [(black,"permutation_summaries[task=refund,first_menu_entry=all].passed"),
                (source,"episodes[task=refund,committed=true,model="+checkpoint+"].passed")],
               refund["passed"]>0 and not any(r["passed"] for r in rows if r["model"]==checkpoint
               and r["task"]=="refund" and r["committed"]),"Exploratory")
    wb="research/recovery/mechanism/whitebox/results.json"
    if "ws_q_steer_pass" in records:
        exports,_=reader(wb)
        steering_log="research/recovery/mechanism/whitebox/records/smollm2-360m/steering-episodes.jsonl"
        full_id="smollm2-360m.refund.53.committed.baseline.canonical"
        [original]=[r for r in journal if r["id"]==full_id]
        [hf]=[r for r in reader(steering_log)[0] if r["id"]==full_id+".control"]
        record("backend-counterexample","On the selected committed refund, GGUF repeatedly updated status and reached exact state without submission, while the original-weight control repeatedly inspected and ended inexact.",
            [(frozen,full_id+" / steps and verdict.endpoints"),(steering_log,hf["id"]+" / steps and verdict.endpoints")],
            all(s["action"]=="mark_refunded" for s in original["steps"]) and all(original["verdict"]["endpoints"].values())
            and not original["verdict"]["submitted"] and all(s["action"]=="inspect" for s in hf["steps"])
            and not all(hf["verdict"]["endpoints"].values()),"Exploratory")
        for model in exports["models"]:
            name=model["id"]
            byarm={r["arm"]:r for r in model["steering"]}
            record("steering-"+name, "Unit steering did not increase exact submitted recovery for "+name+" on the matched held-out episodes.",
                   [(wb,"models[id="+name+"].steering[arm=control or steered].{passed,n}")],
                   byarm["control"]["passed"]==byarm["steered"]["passed"]==0 and byarm["control"]["n"]==byarm["steered"]["n"],
                   "Exploratory")
            record("quantization-"+name, "The original and quantized runs did not always decode the same first response for "+name+".",
                   [(wb,"models[id="+name+"].agreement.{total,exact_replies,paired_valid,matched_actions}")],
                   model["agreement"]["exact_replies"] < model["agreement"]["total"],"Exploratory")
    return result
