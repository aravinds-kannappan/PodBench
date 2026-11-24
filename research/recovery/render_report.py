"""Typeset REPORT.md and its vector figure with Pandoc and XeLaTeX."""
import argparse
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RELEASE = "recovery-v1.0.0"


def link_for_pdf(match):
    target = match.group(1)
    if target.startswith(("https://", "http://", "#")):
        return match.group(0)
    if target.endswith("recovery-figure.png"):
        return "](recovery-figure.pdf)"
    relative, _, fragment = target.partition("#")
    source_path = (HERE / relative).resolve().relative_to(ROOT).as_posix()
    return f"](https://github.com/aravinds-kannappan/PodBench/blob/{RELEASE}/{quote(source_path)}" + (
        f"#{fragment})" if fragment else ")"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=ROOT / "docs/recovery-report.pdf", type=Path)
    output = parser.parse_args().output.resolve()
    title, body = (HERE / "REPORT.md").read_text().split("\n", 1)
    if not title.startswith("# "):
        raise ValueError("Expected the manuscript title in the first heading")
    body = re.sub(r"\]\(([^)\s]+)\)", link_for_pdf, body)
    # Fix the PDF timestamp to the prospective protocol commit's publication day.
    environment = dict(os.environ, SOURCE_DATE_EPOCH="1795525200", FORCE_SOURCE_DATE="1")
    subprocess.run([
        "pandoc", "--from=markdown+pipe_tables+implicit_figures", "--pdf-engine=xelatex", "--metadata", "title=" + title[2:],
        "--variable", "papersize=letter", "--variable", "geometry=margin=0.9in",
        "--variable", "fontsize=11pt", "--variable", "mainfont=Liberation Serif",
        "--variable", "colorlinks=true", "--variable", "urlcolor=blue",
        "--variable", "header-includes=\\setlength{\\emergencystretch}{3em}",
        "--resource-path", str(ROOT / "docs"), "-o", str(output),
    ], input=body, text=True, env=environment, check=True, cwd=ROOT / "docs")


if __name__ == "__main__":
    main()
