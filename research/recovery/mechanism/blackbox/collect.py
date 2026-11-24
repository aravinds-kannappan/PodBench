"""Collect the fixed exploratory grid. Individual decision journals survive interruption."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sys
from probes import DESIGN, HERE, RecoveryEpisode, altered_observation, frozen, jobs, settings


def dump(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def key_for(model, messages):
    # Complete history, checkpoint alias and sampling settings determine a decision.
    return hashlib.sha256(dump([model, DESIGN["max_tokens"], messages]).encode()).hexdigest()


def archive_prefixes(model):
    available = {}
    conflicts = set()
    for line in (HERE.parents[1] / "episodes.jsonl").read_text().splitlines():
        case = json.loads(line)
        if case["model"] != model:
            continue
        msgs = [{"role":"system", "content":case["system"]}, {"role":"user", "content":case["prompt"]}]
        for s in case["steps"]:
            if s["reply"] is None:
                break
            key = key_for(model,msgs)
            response = {k:s[k] for k in ("input_tokens","output_tokens","finish_reason")}
            response["text"] = s["reply"]
            if key in available and response != available[key][0]:
                conflicts.add(key)
            available[key] = response, [case["id"],s["turn"]]
            if "next_user" not in s:
                break
            msgs.extend([{"role":"assistant","content":s["reply"]},{"role":"user","content":s["next_user"]}])
    return {k:v for k,v in available.items() if k not in conflicts}


class Decisions:
    def __init__(self, model, weights, work):
        self.model = model
        self.gen = frozen.Generator(model, weights)
        self.path = work / "decisions"
        self.path.mkdir(exist_ok=True)
        self.archived = archive_prefixes(model)

    def query(self, messages):
        key = key_for(self.model, messages)
        path = self.path / (key + ".json")
        if path.exists():
            record = json.loads(path.read_text())
            return key, record["completion"]
        response, source = self.archived.get(key, (None, None))
        if response is None:
            response = self.gen.complete(messages)
        record = {"key":key,"model":self.model,"messages":messages,"completion":response,"original_episode_turn":source}
        frozen.save(path, dump(record))
        return key, response


def episode(cache, task, seed, committed, variant, permutation):
    model, v = cache.model, variant.id
    env = RecoveryEpisode(task, seed, committed)
    other = RecoveryEpisode(task, seed, not committed)
    try:
        system, prompt, menu, aliases = settings(v, env, model, committed, permutation)
        labels = {label:name for name,label in aliases.items()}
        messages = [{"role":"system","content":system},{"role":"user","content":prompt}]
        rec = {"id": ".".join([model,task,str(seed),str(int(committed)),v]), "model":model, "task":task,
               "seed":seed,"committed":committed,"variant":v,"family":variant.family,"control":variant.control,
               "menu":list(aliases) if permutation is None else list(permutation), "aliases":aliases,
               "steps":[],"status":"step_limit","inspection_seen":False,"after_inspection":None}
        saw_read = False
        for turn in range(1, DESIGN["max_turns"] + 1):
            forced = v.startswith("forced_") and turn == 1
            if forced:
                key, text = None, "inspect"
            else:
                try:
                    key, response = cache.query(messages)
                except (OSError, ValueError, RuntimeError) as e:
                    rec.update(status="inference_error",error=str(e))
                    break
                text = response["text"]
            action = labels.get(text.strip())
            if not forced and "first_action" not in rec:
                rec["first_action"] = action or "invalid"
            if not forced and saw_read and rec["after_inspection"] is None:
                rec["inspection_seen"] = True
                rec["after_inspection"] = action or "invalid"
            step = {"turn":turn, "decision":key,"reply":text,"action":action,"forced":forced}
            rec["steps"].append(step)
            if action is None:
                feedback = "Invalid action. No statement executed. Reply with only one exact action name."
                if v == "number":
                    feedback = feedback.replace("action name", "option number")
            else:
                if action in ("read_clock", "read_label"):
                    actual = {"result":{"clock":"12:00"} if action=="read_clock" else {"label":"blue"},
                              "error":None, "sql":None, "done":False, "action":action}
                else:
                    actual = env.step(action)
                step["observation"] = actual
                if actual["done"]:
                    rec["status"] = "submitted"
                    break
                shown = actual["result"]
                if action == "inspect" and not saw_read:
                    if v.removeprefix("forced_") == "swap":
                        # Replay prior actions in the other world; only its initial commit bit differs.
                        for prev in rec["steps"][:-1]:
                            if prev["action"] in other.actions:
                                other.step(prev["action"])
                    if actual["error"] is None:
                        shown = altered_observation(v, shown, other.step("inspect")["result"])
                    saw_read = True
                step["shown_result"] = shown
                feedback = "Tool result: " + json.dumps({"result":shown,"error":actual["error"]}, separators=(",",":"))
            if turn < DESIGN["max_turns"]:
                if v == "repeated":
                    from probes import VERIFY
                    feedback += "\n" + VERIFY
                messages.extend([{"role":"assistant","content":text},{"role":"user","content":feedback+"\n"+menu}])
        verdict = env.verify()
        rec.update(first_action=rec.get("first_action"), passed=verdict["passed"], submitted=verdict["submitted"],
                   exact_state=all(verdict["endpoints"].values()), endpoints=verdict["endpoints"])
        return rec
    finally:
        env.close()
        other.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qwen-gguf", type=Path, required=True)
    parser.add_argument("--smollm-gguf", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    out = args.output
    out.mkdir(parents=True, exist_ok=args.resume)
    paths = [HERE / name for name in ("collect.py","probes.py","design.json","placebos.json")]
    paths += [HERE.parents[1] / name for name in ("episodes.jsonl","environment.py","run.py")]
    paths.append(frozen.GENERATOR)
    weights = {"qwen2.5-0.5b":args.qwen_gguf,"smollm2-360m":args.smollm_gguf}
    metadata = {model:frozen.Generator(model,path).metadata() for model,path in weights.items()}
    for model,path in weights.items():
        with path.open("rb") as file:
            if hashlib.file_digest(file, "sha256").hexdigest() != metadata[model]["sha256"]:
                raise ValueError(f"Checkpoint mismatch: {model}")
    meta = {"models":metadata, "source_sha256":{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
            "scheduled":{m:len(list(jobs(m))) for m in weights}}
    manifest = out / "manifest.json"
    if args.resume:
        if json.loads(manifest.read_text()) != meta:
            raise ValueError("Resume requires identical sources and weights.")
    else:
        frozen.save(manifest, dump(meta))
    (out / "episodes").mkdir(exist_ok=True)

    def run(model):
        cache = Decisions(model, weights[model], out)
        try:
            for n, job in enumerate(jobs(model),1):
                task, seed, committed, v, perm = job
                path = out / "episodes" / f"{model}.{task}.{seed}.{int(committed)}.{v.id}.json"
                if not (args.resume and path.exists()):
                    rec = episode(cache,*job)
                    frozen.save(path, dump(rec))
                if n % 20 == 0:
                    print(f"{model}: {n}/{meta['scheduled'][model]}",file=sys.stderr,flush=True)
        finally:
            cache.gen.close()

    with ThreadPoolExecutor(max_workers=2) as workers:
        list(workers.map(run, weights))
    for folder, name in (("episodes","traces.jsonl"),("decisions","decisions.jsonl")):
        frozen.save(out/name, "".join(p.read_text()+"\n" for p in sorted((out/folder).glob("*.json"))))


if __name__ == "__main__":
    main()
