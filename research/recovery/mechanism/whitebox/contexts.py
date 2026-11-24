"""Teacher-forced archive prefixes and reference labels for the SQLite workflow."""
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
RECOVERY = HERE.parents[1]
sys.path.insert(0, str(RECOVERY))
from environment import RecoveryEpisode


def target(env):
    # Canonical write plan from the actual state. An overapplied effect cannot be undone.
    v = env.verify()
    d, ep = v["observed"], v["endpoints"]
    if env.task == "refund":
        n = len(d["refund_amounts"])
        missing = n == 0
        over = n > 1
        pending = [] if ep["order_refunded"] else ["mark_refunded"]
    elif env.task == "inventory":
        desired = env.before_stock + env.units
        missing = d["stock"] < desired
        over = d["stock"] > desired
        pending = [] if ep["receipt_posted"] else ["close_receipt"]
    else:
        n = len(d["archive_emails"])
        missing = n == 0
        over = n > 1 or (missing and ep["customer_removed"])
        pending = [a for a, endpoint in (("move_orders", "orders_moved"), ("remove_customer", "customer_removed"))
                   if not ep[endpoint]]
    if over:
        return None
    return env.first_action if missing else (pending or ["submit"])[0]


def archive(model):
    return [row for line in (RECOVERY / "episodes.jsonl").read_text().splitlines()
            if (row := json.loads(line))["model"] == model]


def examples(episodes):
    rows = []
    for e in episodes:
        env = RecoveryEpisode(e["task"], e["seed"], e["committed"])
        messages = [{"role":"system","content":e["system"]}, {"role":"user","content":e["prompt"]}]
        inspected = False
        saved_post_inspect = False
        try:
            for s in e["steps"]:
                if s["turn"] <= 2 or inspected and not saved_post_inspect:
                    row = {k:e[k] for k in ("id","seed","task","instruction","committed","menu_order","menu")}
                    rows.append(dict(row, turn=s["turn"], messages=list(messages), inspected=inspected,
                                     target=target(env), reply=s["reply"], action=s["action"]))
                    saved_post_inspect |= inspected
                if s["valid"]:
                    env.step(s["action"])
                    inspected |= s["action"] == "inspect"
                if "next_user" in s:
                    messages.extend([{"role":"assistant","content":s["reply"]},
                                     {"role":"user","content":s["next_user"]}])
        finally:
            env.close()
    return rows
