"""Render the four short condition accounts and their comparison from saved measurements."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS = {"qwen2.5-0.5b":"Qwen2.5-0.5B", "smollm2-360m":"SmolLM2-360M"}
ARMS = {"baseline":"generic recovery request","inspect_first":"inspect-first instruction"}
SUM = "[Computed counts and probability contrasts](scores-summary.json)"
SCORES = "[All decision-level token probabilities](scores-decisions.jsonl)"
SWAPS = "[Counterfactual scores](scores-swaps.jsonl)"


def counts(data):
    return ", ".join(f"{name} × {n}" for name,n in data.items())


def generate(s, report):
    contrasts = s["first_step_contrasts"]
    conditions = {(r["model"],r["instruction"]):r for r in s["conditions"]}
    outcomes = {r["model"]:r["by_instruction"] for r in report["by_model"]}
    cards = []
    for (model,arm),c in conditions.items():
        outcome = outcomes[model][arm]
        other = conditions[model,"inspect_first" if arm=="baseline" else "baseline"]
        first = c["first_actions"]
        direction = "more" if c["first_mean_inspect"] > other["first_mean_inspect"] else "less"
        title = f"{MODELS[model]} with the {ARMS[arm]}"
        path = f"explain-{model}-{arm}.md"
        cards.append(f"[{title}]({path})")
        lines = [f"# {title}", "", "Exploratory analysis of archived decisions.", "",
                 f"The model selected `inspect` first in **{first.get('inspect',0)}/{c['first_n']}** episodes and "
                 f"`submit` first in **{first.get('submit',0)}/{c['first_n']}**. Across the same work orders its "
                 f"mean probability of the complete inspect response, normalized over menu responses, was "
                 f"{c['first_mean_inspect']:.1%}, {direction} than the {other['first_mean_inspect']:.1%} under the other instruction. "
                 f"The run ended in exact state with explicit submission {outcome['passed']}/{outcome['scheduled']} times. "
                 +SUM+" · [SQLite verification](../../../docs/recovery-results.json)", "",
                 "## The first decision", "", "| Menu | Interrupted write | Episodes | Recorded responses |",
                 "| --- | --- | ---: | --- |"]
        def menu_count(menu, action):
            return sum(r["chosen"].get(action, 0) for r in c["first_worlds"] if r["menu_order"] == menu)

        canonical = menu_count("canonical", "inspect")
        reversed_inspect = menu_count("reversed", "inspect")
        reversed_submit = menu_count("reversed", "submit")
        reversed_invalid = menu_count("reversed", "invalid")
        if model == "qwen2.5-0.5b" and arm == "baseline":
            menu_story = (f"On the reversed menu the checkpoint began by submitting {reversed_submit} times and "
                          f"gave an invalid first reply {reversed_invalid} times.")
        elif model == "smollm2-360m" and arm == "inspect_first":
            removes = menu_count("reversed", "remove_customer")
            menu_story = (f"The canonical menu accounted for {canonical} first inspections. The reversed menu produced "
                          f"{reversed_inspect} first inspections, {reversed_submit} submissions, {removes} attempts "
                          f"to remove a customer and {reversed_invalid} invalid first replies.")
        else:
            menu_story = (f"The canonical menu produced {canonical} first inspections. With the reversed menu, "
                          f"the checkpoint first inspected {reversed_inspect} times and submitted immediately "
                          f"{reversed_submit} times.")
        for row in c["first_worlds"]:
            lines.append(f"| {row['menu_order']} | {'committed' if row['committed'] else 'absent'} | {row['n']} | {counts(row['chosen'])} |")
        lines += ["", menu_story + " " + SUM, "", "The first prompt is identical across the paired hidden states. Each order has twelve first decisions per state. "
                  "The rows show the replies before the model could inspect the database. "+SUM,"",
                  "## Later decisions","","| Turn | Decisions | Recorded responses | Leading first-token candidate¹ |",
                  "| ---: | ---: | --- | --- |"]
        for t in c["turns"]:
            v=t["top_first_tokens"][0]
            lines.append(f"| {t['turn']} | {t['n']} | {counts(t['chosen'])} | `{v['text'].replace(chr(10),'⏎').replace('|','¦')}` ({v['mean_probability_lower_bound']:.1%}) |")
        lines += ["","¹ Ranked by summed probability across the ten saved first-token candidates per decision. A token outside the top ten contributes zero, "
                  "so the percentage is a lower bound on its mean vocabulary probability. Each later turn includes only episodes still running. "
                  +SCORES,"","## After inspection",""]
        p=c["post_inspect"]
        if p["n"]:
            best=c["example_swap"]
            lines.append(f"We replaced the latest inspection result with the result after replaying the same moves in the opposite commit state. "
                         f"All earlier messages stayed fixed. There were {p['n']} such next decisions and {p['changed_inputs']} feedback replacements that differed from the original "
                         f"in these comparisons. The highest-scoring legal action changed in {p['top_flips']}/{p['n']} comparisons. Mean total variation distance was "
                         f"{p['mean_tv']:.3f} on a scale from zero (identical menu distribution) to one (disjoint). {SWAPS}")
            lines += ["", "In the archived continuations, " + " and ".join(
                ("the initially committed world" if w["committed"] else "the initially absent world")
                + f" supplied {w['n']} next decisions ({counts(w['chosen'])})"
                for w in p["observed_next_by_world"]) + ". Across changed readings the mean probability of reapplying the "
                "uncertain write differed by " + f"{100*p['mean_retry_absent_minus_committed']:+.2f} percentage points "
                "(initially absent minus committed, orienting every swap the same way). " + SUM]
            lines+=["",f"The largest observed shift was {best['tv']:.3f} in `{best['episode_id']}`, turn {best['turn']}. "
                    f"The original top action was `{best['logged_top']}` and the swapped top action was `{best['swapped_top']}`. "+SUM]
        else:
            lines.append(f"There were no archived next decisions immediately following inspection in this condition. "
                         f"The corpus therefore supplies no within-prefix observation swap for this condition. {SUM}")
        lines += ["","[Compare all four conditions](explain-comparison.md) · [Scoring and reproduction](scores-method.md)",""]
        (HERE/path).write_text("\n".join(lines))
    compare = ["# How the recovery instruction changed the next action", "", "Exploratory comparison across the frozen 192-episode recovery grid.", "",
               "| Checkpoint | Instruction | First inspection | Mean legal P(inspect) | Post-inspection swaps | Mean swap distance |",
               "| --- | --- | ---: | ---: | ---: | ---: |"]
    for (model,arm),c in conditions.items():
        p=c["post_inspect"]
        distance = f"{p['mean_tv']:.3f}" if p["n"] else "—"
        compare.append(f"| {MODELS[model]} | {ARMS[arm]} | {c['first_actions'].get('inspect',0)}/{c['first_n']} | {c['first_mean_inspect']:.1%} | {p['n']} | {distance} |")
    compare.extend(["",f"Qwen first inspected more often under the explicit instruction, while SmolLM first inspected less often. "
                    f"All 192 episodes ended without a verified submission in the exact target state. Observing the first move alone would miss that outcome. "
                    +SUM+" · [Recovery outcomes](../../../docs/recovery-results.json)","",
                    "## Which response gained probability on the first turn?","",
                    "The entries below subtract the generic instruction from the inspect-first instruction, in percentage points, for each exact menu response. "
                    "Each mean uses 16 first decisions per model, family and instruction. Probabilities are normalized over canonical tokenizations followed by end-of-turn. "+SCORES,"",
                    "| Family | Action | Qwen change (pp) | SmolLM change (pp) |","| --- | --- | ---: | ---: |"])
    by_action = {}
    for x in contrasts:
        by_action.setdefault((x["task"],x["action"]),{})[x["model"]]=100*x["delta"]
    for (task,action),v in sorted(by_action.items()):
        compare.append(f"| {task} | `{action}` | {v['qwen2.5-0.5b']:+.1f} | {v['smollm2-360m']:+.1f} |")
    compare.extend(["","Each swap changes only the latest tool result. Its total variation distance measures movement over complete legal action responses. "
                    "Repeated decisions from the same episode contribute multiple rows. The four condition accounts give the number that changed the highest-scoring action and show the largest measured shift. "+SWAPS,"",
                    *["- "+card for card in cards],"","[All numerical comparisons](scores-summary.json) · [Scoring and reproduction](scores-method.md)",""])
    (HERE/"explain-comparison.md").write_text("\n".join(compare))


if __name__ == "__main__":
    generate(json.loads((HERE/"scores-summary.json").read_text()),
             json.loads((HERE.parents[2]/"docs/recovery-results.json").read_text()))
