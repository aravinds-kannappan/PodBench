"""Render the study figure from the public summary (optional dependency: matplotlib)."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

ROOT = Path(__file__).resolve().parents[2]
LABELS = {"qwen2.5-0.5b": "Qwen2.5-0.5B-Instruct", "smollm2-360m": "SmolLM2-360M-Instruct"}
MEASURES = (("first_inspection", "Inspected first"), ("submitted", "Submitted"), ("passed", "Exact recovery"))


def render(summary, target):
    plt.rcParams.update({"font.size": 9, "pdf.fonttype": 42, "font.family": "DejaVu Sans"})
    models = summary["by_model"]
    fig, axes = plt.subplots(len(models), 1, figsize=(6.65, 4.7), sharex=True, squeeze=False)
    for ax, model in zip(axes[:, 0], models):
        for arm, label, shift, color in [
            ("baseline", "Generic instruction", 0.16, "#375A70"),
            ("inspect_first", "Inspect-first instruction", -0.16, "#AA562D"),
        ]:
            counts = model["by_instruction"][arm]
            n = counts["scheduled"]
            y = [2 - i + shift for i in range(len(MEASURES))]
            x = [counts[key] / n for key, _ in MEASURES]
            ax.barh(y, x, height=0.26, color=color, label=label)
            for pos, fraction, (key, _) in zip(y, x, MEASURES):
                ax.text(fraction + 0.018, pos, f"{counts[key]}/{n}", va="center", fontsize=8)
        ax.set_title(LABELS[model["model"]], loc="left", fontsize=10, fontweight="bold", pad=6)
        ax.set_yticks([2, 1, 0], [item[1] for item in MEASURES])
        ax.set_ylim(-0.5, 2.5)
        ax.set_xlim(0, 1.15)
        ax.grid(axis="x", color="#D7D9DA", linewidth=0.6)
        ax.set_axisbelow(True)
        ax.spines[["right", "top", "left"]].set_visible(False)
        ax.tick_params(axis="y", length=0)
    axes[-1, 0].set_xticks([0, .25, .5, .75, 1])
    axes[-1, 0].xaxis.set_major_formatter(PercentFormatter(1, decimals=0))
    axes[-1, 0].set_xlabel("Share of scheduled episodes")
    fig.legend(*axes[0, 0].get_legend_handles_labels(), ncol=2, loc="upper left",
               bbox_to_anchor=(.16, 1), frameon=False, fontsize=9)
    fig.subplots_adjust(left=.20, right=.97, top=.84, bottom=.13, hspace=.43)
    fig.savefig(target.with_suffix(".pdf"), metadata={"CreationDate": None, "ModDate": None}, bbox_inches="tight")
    fig.savefig(target.with_suffix(".png"), dpi=220, bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=ROOT / "docs/recovery-results.json")
    parser.add_argument("--prefix", type=Path, default=ROOT / "docs/recovery-figure")
    args = parser.parse_args()
    render(json.loads(args.summary.read_text()), args.prefix)
