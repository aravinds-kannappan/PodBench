"""Insert measured exploratory results only when the corresponding study export exists."""
import json

PREFIX = "research/recovery/mechanism/"


def measured_sections(claims, root):
    sections = {"menu_abstract": ""}
    tracefile = PREFIX + "trace_episodes.csv"
    claims.specs["reach_episodes"] = {"source":tracefile,"op":"size"}
    table = [
        "| Through decision | Exact state unreachable | Exact submission unreachable |",
        "| --------------------- | ----------------------------: | --------------------------------: |",
    ]
    for turn, label in enumerate(("First", "Second", "Third", "Fourth", "Fifth"), 1):
        cells = []
        for endpoint in ("exact", "submission"):
            key = f"reach_{endpoint}_{label.lower()}"
            claims.specs[key] = {"source":tracefile,"op":"first_loss_by_turn",
                                 "field":f"first_unreachable_{endpoint}","turn":turn}
            cells.append("{{"+key+"}}")
        table.append(f"| {label} | {cells[0]} | {cells[1]} |")
    sections["reach_table"] = "\n".join(table)
    pending = []
    scorefile = PREFIX + "scores-summary.json"
    blackfile = PREFIX + "blackbox/results.json"
    whitefile = PREFIX + "whitebox/results.json"
    forced = PREFIX+"forcing.jsonl"
    if (root / forced).is_file():
        def branch_count(key, policy, eligible):
            where = {"policy":policy,"eligible":True}
            if not eligible:
                where["passed"]=True
            claims.specs[key] = {"source":forced,"op":"matches","where":where}
            return "{{"+key+"}}"
        op=branch_count("force_oracle_pass","oracle",False)
        on=branch_count("force_oracle_n","oracle",True)
        ep=branch_count("force_evidence_pass","evidence",False)
        en=branch_count("force_evidence_n","evidence",True)
        sections["forcing_prose"] = (f"Replacing one decision on a saved prefix and then resuming the original policy produced {op}/{on} exact submissions on eligible shortest-path oracle interventions and {ep}/{en} on eligible evidence-respecting interventions. The oracle can use the hidden state. The policies have different eligible prefixes, and several prefixes can come from one episode. These conditional rates describe recovery after an externally supplied move.")
    else:
        pending.append(forced)
        sections["forcing_prose"] = "The corrected-action continuation comparison is pending in this draft."
    numericfile=PREFIX+"scores-numerics.json"
    cold_files=[root/PREFIX/name for name in ("scores-decisions.jsonl","scores-swaps.jsonl")]
    cold_ready = ((root / scorefile).is_file() and (root / numericfile).is_file() and
        all(path.is_file() and path.stat().st_size>0 and all(json.loads(line).get("scoring_version")=="cold-prefix-v2"
            for line in path.read_text().splitlines()) for path in cold_files))
    if cold_ready:
        result = json.loads((root / scorefile).read_text())
        terms = {}
        conditions = {}
        for index, row in enumerate(result["conditions"]):
            model = "q" if row["model"] == "qwen2.5-0.5b" else "s"
            arm = "g" if row["instruction"] == "baseline" else "v"
            conditions[model+arm] = index
            terms[model+arm] = claims.tag("score_"+model+arm,scorefile,
                                        f"/conditions/{index}/first_mean_inspect",4)
        count = claims.tag("scores_completed",scorefile,"/decision_count")
        swaps = claims.tag("score_swap_count",scorefile,"/observation_swaps")
        sections["scores_prose"] = (
            f"We scored legal alternatives at {count} archived decisions and compared {swaps} "
            "post-inspection prefixes with their opposite-world observation. Averaged over opening decisions, "
            f"the probability assigned to inspection after renormalizing across complete menu candidates went from "
            f"{terms['qg']} to {terms['qv']} for Qwen and from {terms['sg']} to {terms['sv']} for SmolLM2. "
            "These scores concern exact candidate strings with the scorer’s boundary convention. "
            "They describe relative weight within the menu and exclude probability mass assigned to other text.")
        swap_details=[]
        for key, name in (("qv","Qwen verify-first"), ("sg","SmolLM2 generic"), ("sv","SmolLM2 verify-first")):
            ptr=f"/conditions/{conditions[key]}/post_inspect/"
            flips=claims.tag(key+"_flips",scorefile,ptr+"top_flips")
            eligible=claims.tag(key+"_swaps",scorefile,ptr+"n")
            distance=claims.tag(key+"_distance",scorefile,ptr+"mean_tv",5)
            swap_details.append(f"{name} changed the leading candidate on {flips}/{eligible} swaps (mean total variation {distance})")
        controls=[]
        for i,alias in enumerate(("qwen2.5-0.5b","smollm2-360m")):
            prefix="/"+alias+"/identical_observed_and_swapped_inputs/"
            n=claims.tag(f"cold_repeat_{i}",numericfile,prefix+"n")
            diff=claims.tag(f"cold_drift_{i}",numericfile,prefix+"max_tv",4)
            controls.append(f"{diff} across {n} repeated inputs")
        resets_q=claims.tag("q_full_reset_n",numericfile,"/qwen2.5-0.5b/full_reset_each_candidate/n")
        resets_s=claims.tag("s_full_reset_n",numericfile,"/smollm2-360m/full_reset_each_candidate/n")
        reset_q=claims.tag("q_full_reset_max",numericfile,"/qwen2.5-0.5b/full_reset_each_candidate/max_tv",4)
        reset_s=claims.tag("s_full_reset_max",numericfile,"/smollm2-360m/full_reset_each_candidate/max_tv",4)
        warmfile=PREFIX+"scores-warm-controls.json"
        warm_n=claims.tag("warm_s_n",warmfile,"/repeat_controls/smollm2-360m/identical_observed_and_swapped_inputs/n")
        warm_mean=claims.tag("warm_s_mean",warmfile,"/repeat_controls/smollm2-360m/identical_observed_and_swapped_inputs/mean_tv",4)
        old_swap=claims.tag("superseded_smollm_generic_tv",warmfile,"/superseded_swap_summaries/smollm2-360m/baseline/mean_tv",4)
        old_n=claims.tag("superseded_smollm_generic_n",warmfile,"/superseded_swap_summaries/smollm2-360m/baseline/n")
        correction=(f"In the superseded warm-prefix pass, {warm_n} identical SmolLM2 inputs had a mean total variation of {warm_mean} between scoring passes, exceeding the preliminary {old_swap} mean across {old_n} generic observation swaps. We discarded the warm scores as evidence for the treatment and repeated the calculation with fresh prefix contexts and the generator’s single-token continuation batch geometry. The changes were made together.")
        sections["scores_prose"] += " " + correction
        sections["scores_prose"] += " After the correction, the maximum total variation under identical-input controls was " + " for Qwen and ".join(controls) + " for SmolLM2."
        sections["scores_prose"] += f" Resetting the entire prefix for each candidate yielded maximum total variation {reset_q} on {resets_q} Qwen and {reset_s} on {resets_s} SmolLM2 controls."
        sections["scores_prose"] += " " + ". ".join(swap_details) + ". Qwen generic had no eligible post-inspection prefix. These swaps rescore the same fixed action menu at an archived prefix."
        sections["probe_blog_prose"] = (
            f"For Qwen, inspection’s mean opening probability within the scored legal menu changed from "
            f"{terms['qg']} to {terms['qv']} with the reminder. The actual worker could still generate text outside "
            "that menu. The normalized figure is conditional on the comparison set. I would not use it as the "
            "probability that the live console will receive a valid inspection request.")
        sections["probe_blog_prose"] += f" The first, superseded implementation produced a mean total variation of {warm_mean} on {warm_n} identical SmolLM2 inputs, larger than the apparent {old_swap} change when swapping the generic observation. With a comparison that moves even when the text stays fixed, I cannot interpret a small apparent effect of an altered observation. The study repeated the score measurements under cold contexts and checked repeats before interpreting changes."
        auditfile=PREFIX+"scores-audit.json"
        if (root/auditfile).is_file():
            verified=[]
            for key, alias, label in (("q","qwen2.5-0.5b","Qwen"),("s","smollm2-360m","SmolLM2")):
                matched=claims.tag("greedy_"+key+"_all",auditfile,"/"+alias+"/matches_all")
                total=claims.tag("greedy_"+key+"_n",auditfile,"/"+alias+"/n")
                verified.append(f"{matched}/{total} {label} decisions")
            canonical=claims.tag("greedy_q_canonical",auditfile,"/qwen2.5-0.5b/matches_canonical_token_path")
            sections["probe_blog_prose"] += " A separate unrestricted greedy replay reproduced the original reply, output count and stop reason on "+" and ".join(verified)+". That check helped distinguish the score implementation failure from a change to the frozen behavior."
            sections["probe_blog_prose"] += f" Canonical tokenization matched the naturally generated path for {canonical}/{{{{greedy_q_n}}}} Qwen replies. A displayed word can have more than one legal token sequence."
        else:
            pending.append(auditfile)
    else:
        pending.append("verified cold-context scores and numerical controls")
        sections["scores_prose"] = "The cold-context score audit is pending. This draft withholds probability contrasts until the repeated-prefix controls are complete."
        sections["probe_blog_prose"] = "The scored menu comparisons are pending in this draft. A measured ranking and the original free response belong together in the published record."
    if (root / blackfile).is_file():
        result = json.loads((root / blackfile).read_text())
        nums = [claims.tag("bb_"+k,blackfile,"/coverage/"+k) for k in
                ("episodes","permutations","new_inferences","unique_from_parent")]
        sections["blackbox_prose"] = (
            f"The follow-up contains {nums[0]} controlled episodes, including {nums[1]} menu permutations. "
            f"The inference cache records {nums[2]} new requests and {nums[3]} unique decisions reused from the parent archive. "
            "Duplicate prompts reuse a response, so an episode count is not a count of independent model calls. "
            "The permutation panel uses a single checkpoint and starting condition, while the smaller matched "
            "wording and observation comparisons apply to the designated refund fixture. Both hidden worlds share the initial text within checkpoint. Matched length controls token and character counts, but an imperative reminder and a declarative placebo differ in what they ask the worker to do.")
        def active_total(key, field):
            claims.specs[key] = {"source":blackfile,"pointer":"/variants","op":"sum_matched",
                "where":{"family":"paraphrase"},"field":"/by_model/qwen2.5-0.5b/submitted/"+field}
            return "{{"+key+"}}"
        active_n=active_total("bb_qword_n","n")
        active_sub=active_total("bb_qword_submitted","treatment")
        placebo_sub=active_total("bb_qplacebo_submitted","control")
        sections["blackbox_prose"] += f" Qwen submitted in {active_sub}/{active_n} active-wording episodes versus {placebo_sub}/{active_n} neutral placebos on that fixture."
        swap = next(i for i, row in enumerate(result["variants"]) if row["id"]=="forced_swap")
        n=claims.tag("bb_forced_n",blackfile,f"/variants/{swap}/n")
        g=claims.tag("bb_forced_g",blackfile,f"/variants/{swap}/passed/control")
        v=claims.tag("bb_forced_v",blackfile,f"/variants/{swap}/passed/treatment")
        sections["blackbox_prose"] += f" After a supplied inspection, showing the opposite-world result yielded {v} verified recoveries versus {g} for correct feedback across {n} matched cases."
        tooltip = next(i for i, row in enumerate(result["variants"]) if row["id"]=="forced_tool_note")
        prefix = f"/variants/{tooltip}/submit_after_inspect/"
        n=claims.tag("bb_toolnote_n",blackfile,prefix+"n")
        g=claims.tag("bb_toolnote_control",blackfile,prefix+"control")
        v=claims.tag("bb_toolnote_treatment",blackfile,prefix+"treatment")
        sections["blackbox_prose"] += f" Adding an instruction to submit now to a supplied observation changed immediate submissions from {g}/{n} to {v}/{n}."
        refund = next(i for i, row in enumerate(result["permutation_summaries"])
                       if row["task"]=="refund" and row["first_menu_entry"]=="all")
        won = claims.tag("bb_refund_exact",blackfile,f"/permutation_summaries/{refund}/passed")
        layouts = claims.tag("bb_refund_orders",blackfile,f"/permutation_summaries/{refund}/orders")
        sections["menu_abstract"] = f"In an exploratory menu sweep Qwen recovered the committed refund on {won}/{layouts} presentations of the same work order. "
        sections["blackbox_prose"] += f" On the committed refund, Qwen achieved exact submitted recovery in {won}/{layouts} menu layouts. The earlier canonical and reversed orders had both missed this outcome on the same work order."
        index=next(i for i,row in enumerate(result["permutation_summaries"])
                   if row["task"]=="transfer" and row["first_menu_entry"]=="all")
        prefix=f"/permutation_summaries/{index}/"
        selected=claims.tag("bb_transfer_first",blackfile,prefix+"chose_first_entry")
        denominator=claims.tag("bb_transfer_orders",blackfile,prefix+"orders")
        passed=claims.tag("bb_transfer_passed",blackfile,prefix+"passed")
        sections["blackbox_prose"] += f" Across {denominator} transfer menu orderings, Qwen chose the first listed entry {selected} times and completed {passed} exact submissions."
        inventory = next(i for i, row in enumerate(result["permutation_summaries"])
                         if row["task"]=="inventory" and row["first_menu_entry"]=="all")
        inv_won = claims.tag("bb_inventory_exact",blackfile,f"/permutation_summaries/{inventory}/passed")
        inv_orders = claims.tag("bb_inventory_orders",blackfile,f"/permutation_summaries/{inventory}/orders")
        sections["blackbox_prose"] += f" Inventory yielded {inv_won}/{inv_orders} verified recoveries."
        tracepath=PREFIX+"blackbox/traces.jsonl"
        traceurl="https://github.com/aravinds-kannappan/PodBench/blob/recovery-mechanism-v1.0.0/"+tracepath
        winners=[]
        for line, raw in enumerate((root/tracepath).read_text().splitlines(),1):
            row=json.loads(raw)
            if row["family"]=="permutation" and row["passed"]:
                name=" → ".join(step["action"] for step in row["steps"])
                winners.append(f"[{name}]({traceurl}#L{line})")
        sections["blackbox_prose"]+=" The successful sequences were "+" · ".join(winners)+"."

    else:
        pending.append(blackfile)
        sections["blackbox_prose"] = "The complete black-box panel is pending in this draft. A planned contrast is not entered as a measured result."
    readouts=[]
    for alias, label in (("qwen2.5-0.5b","Qwen"),("smollm2-360m","SmolLM2")):
        record=PREFIX+f"whitebox/records/{alias}/readout-summary.json"
        if not (root / record).is_file():
            continue
        result=json.loads((root / record).read_text())
        prefix="wq" if label=="Qwen" else "ws"
        def ref(key,path,digits=None):
            return claims.tag(prefix+"_"+key,record,path,digits)
        scanned=ref("contexts","/agreement/total")
        agreed=ref("agree","/agreement/matched_actions")
        valid=ref("valid","/agreement/paired_valid")
        drift=ref("drift","/agreement/inspect_mean_abs_probability_difference",3)
        last=max(x["layer"] for x in result["probes"])
        indices={row["target"]:i for i,row in enumerate(result["probes"]) if row["layer"]==last}
        i=indices["instruction"]
        accuracy=ref("instruction",f"/probes/{i}/accuracy",3)
        shuffle=ref("shuffle",f"/probes/{i}/shuffled_accuracy",3)
        test_n=ref("test_n",f"/probes/{i}/test_n")
        hidden=ref("first_hidden",f"/probes/{indices['hidden_commit']}/subsets/first_turn/accuracy",3)
        readouts.append(f"For {label}, among {scanned} held-out first-turn texts, original and quantized models selected the same action on {agreed}/{valid} jointly parseable replies. Mean absolute drift in probability of the first inspect token was {drift}. On {test_n} held-out decision rows, final-block classification of the instruction achieved accuracy {accuracy}, compared with {shuffle} under shuffled training labels. Hidden-state accuracy before any tool feedback was {hidden}.")
    sections["whitebox_prose"] = " ".join(readouts) + (
        " Hidden-world pairs start from identical text. Distinguishing that bit at the opening decision would indicate leakage or a scoring defect. "
        "Instruction labels are visible in the prompts. Their decodability can coexist with uninformative hidden-state prediction. In the held-out generic committed refund with canonical menu, the frozen SmolLM2 repeatedly updated status and reached exact state. Its matched original-weight control repeatedly inspected and ended inexact. Precision and runtime both changed. "
        "Training and testing use separate fixture seeds, yet repeated context positions and shared workflow templates limit independence.")
    if (root / whitefile).is_file():
        result=json.loads((root / whitefile).read_text())
        findings=[]
        for i,model in enumerate(result["models"]):
            alias="q" if model["id"].startswith("qwen") else "s"
            label="Qwen" if alias=="q" else "SmolLM2"
            grid=model["steering"]
            control=next(j for j,r in enumerate(grid) if r["arm"]=="control")
            treated=next(j for j,r in enumerate(grid) if r["arm"]=="steered")
            def steer(key,j,name):
                return claims.tag(f"ws_{alias}_{key}",whitefile,f"/models/{i}/steering/{j}/{name}")
            n=steer("n",treated,"n")
            c=steer("control_inspect",control,"inspect_first")
            t=steer("steer_inspect",treated,"inspect_first")
            cp=steer("control_pass",control,"passed")
            tp=steer("steer_pass",treated,"passed")
            layer=grid[treated]["layer"]
            mid=next(j for j,r in enumerate(model["lens"]) if r["layer"]==layer)
            agreement=claims.tag(f"lens_{alias}_agreement",whitefile,f"/models/{i}/lens/{mid}/vocab_final_agreement",3)
            rows=claims.tag(f"lens_{alias}_n",whitefile,f"/models/{i}/lens/{mid}/n")

            pi=next(j for j,r in enumerate(model["patching"]) if r["component"]=="residual" and r["layer"]==layer)
            def patch(key):
                return claims.tag(f"wp_{alias}_{key}",whitefile,f"/models/{i}/patching/{pi}/{key}")
            details = f"For {label}, opening inspections changed from {c} to {t} across {n} episodes per arm, and verified completion changed from {cp} to {tp}."
            details += f" The unrestricted midpoint logit lens agreed with the final token leader at rate {agreement} across {rows} decision rows."
            if model["patching"][pi]["discordant_leaders"]:
                details += f" At that midpoint residual patch, {patch('moved_to_donor')}/{patch('discordant_leaders')} pairs with different natural menu-token leaders acquired the donor leader."
            else:
                details += " The matched contexts had no discordant natural menu-token leaders for assessing midpoint donor transfer."
            final_layer=max(r["layer"] for r in model["patching"])
            fi=next(j for j,r in enumerate(model["patching"]) if r["component"]=="residual" and r["layer"]==final_layer)
            if model["patching"][fi]["full_reply_pairs"]:
                fn=claims.tag(f"final_{alias}_valid",whitefile,f"/models/{i}/patching/{fi}/full_reply_pairs")
                moved=claims.tag(f"final_{alias}_move",whitefile,f"/models/{i}/patching/{fi}/moved_to_donor_action")
                details += f" At the final block, the residual patch transferred the donor’s complete action in {moved}/{fn} eligible natural-action contrasts."
            findings.append(details)
        sections["probe_blog_prose"] += (
            " In a separate original-weight experiment, the unit steering intervention produced "
            "{{ws_q_steer_pass}}/{{ws_q_n}} exact submitted recoveries on Qwen and {{ws_s_steer_pass}}/{{ws_s_n}} on SmolLM2. "
            "A change in an internal representation has to survive the action interface and the later turns before it can count as a recovered job.")
        sections["whitebox_prose"] += ("\n\nA fixed unit steering coefficient applied the training-set verify-first direction once at the last prompt position in the middle block. We compare it with zero steering on matched held-out workflows. " + " ".join(findings) +
            " Eligibility for complete-action transfer required different valid natural replies in both contexts. The late residual replacement is an expected positive control. These selected cases do not identify a unique circuit or imply better recovery. "
            "[Original-weight outputs](https://github.com/aravinds-kannappan/PodBench/blob/recovery-mechanism-v1.0.0/"+whitefile+")")
    else:
        pending.append(whitefile)
        sections["whitebox_prose"] += " The intervention summary is pending in this draft."
    return sections, pending
