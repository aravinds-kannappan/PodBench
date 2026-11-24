"""Render the paired recovery study's data-linked writing. Run from any directory."""
import argparse
import csv
import hashlib
import html
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from functools import lru_cache
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "research/recovery/site/public/writing"
MECH = "research/recovery/mechanism/"
GITHUB = "https://github.com/aravinds-kannappan/PodBench/blob/"
MECHANISM_RELEASE = "recovery-mechanism-v1.0.0"
PUBLIC = "https://pod-bench.vercel.app/recovery/writing/"
BANNED = ["—", "–", "delve", "landscape", "crucial", "it's important to note",
          "in conclusion", "moreover", "furthermore", "game-changer", "unlock", "navigate", "tapestry", "journey"]
AUTHOR = re.compile(r"\[AUTHOR\s*:[^\]]*\]", re.I)
TAG = re.compile(r"\{\{([a-zA-Z0-9_]+)\}\}")
DATE = "2026-11-24"



@lru_cache(maxsize=None)
def read_input(name):
    path = ROOT / name
    raw = path.read_bytes()
    if path.suffix == ".csv":
        data = list(csv.DictReader(io.StringIO(raw.decode())))
    elif path.suffix == ".jsonl":
        data = [json.loads(line) for line in raw.splitlines()]
    elif path.suffix == ".json":
        data = json.loads(raw)
    else:
        data = raw.decode()
    return data, hashlib.sha256(raw).hexdigest()


def evidence(name, fragment=""):
    revision = MECHANISM_RELEASE if name.startswith(MECH) else "recovery-v1.0.0"
    return GITHUB + revision + "/" + name + fragment


def pointer(data, address):
    for part in address.strip("/").split("/") if address.strip("/") else []:
        part = part.replace("~1", "/").replace("~0", "~")
        data = data[int(part)] if isinstance(data, list) else data[part]
    return data


def evaluate(definition):
    data, digest = read_input(definition["source"])
    item = pointer(data, definition.get("pointer", ""))
    op = definition.get("op")
    fragment = ""
    if op == "size":
        item = len(item)
    elif op == "distinct":
        item = len({tuple(r[k] for k in definition["fields"]) for r in item})
    elif op == "total_length":
        item = sum(len(r[definition["field"]]) for r in item)
    elif op == "reply_count":
        [(index, row)] = [(i, r) for i, r in enumerate(item) if r["id"] == definition["id"]]
        item = sum(s["reply"] == definition["reply"] for s in row["steps"])
        fragment = "#L" + str(index + 1)
    elif op == "first_loss_by_turn":
        field = definition["field"]
        turn = definition["turn"]
        item = sum(bool(row[field]) and int(row[field]) <= turn for row in item)
    elif op == "sum_matched":
        selected = [r for r in item if all(r[k] == v for k,v in definition["where"].items())]
        if not selected:
            raise ValueError(f"Empty subgroup for {definition}")
        item = sum(pointer(r,definition["field"]) for r in selected)
    elif op == "matches":
        item = sum(all(r[k] == v for k, v in definition["where"].items()) for r in item)
    elif op is not None:
        raise ValueError(f"Unknown operation {op}")
    if isinstance(item, bool) or not isinstance(item, (float, int)) or not math.isfinite(item):
        raise ValueError(f"Non-numeric evidence in {definition}")
    if definition["source"].endswith(".jsonl") and definition.get("pointer"):
        fragment = "#L" + str(int(definition["pointer"].split("/")[1]) + 1)
    item *= definition.get("scale", 1)
    stage = "exploratory" if definition["source"].startswith(MECH) else "frozen archive"
    return {**definition, "value": item, "stage": stage, "sha256": digest, "url": evidence(definition["source"], fragment)}


class Claims:
    def __init__(self):
        self.specs = json.loads((HERE / "claims-spec.json").read_text())
        self.records = {}
        self.passages = []
        self.document = ""

    def tag(self, key, source, address, digits=None):
        self.specs[key] = {"source": source, "pointer": address}
        if digits is not None:
            self.specs[key]["digits"] = digits
        return "{{" + key + "}}"

    def render(self, text, name):
        self.document = name
        def cite(match):
            key = match[1]
            if key not in self.records:
                self.records[key] = {**evaluate(self.specs[key]), "appears_in":[]}
            row = self.records[key]
            if name not in row["appears_in"]:
                row["appears_in"].append(name)
            value = row["value"]
            display = f"{value:.{row['digits']}f}" if "digits" in row else f"{value:g}"
            return f"[{display}]({row['url']})"
        rendered = TAG.sub(cite, text)
        for block in text.split("\n\n"):
            keys = list(dict.fromkeys(TAG.findall(block)))
            if keys:
                self.passages.append({"document":name,"claim_text":TAG.sub(lambda m: str(self.records[m[1]]["value"]), block),
                    "claims":keys,"status":"verified against source fields",
                    "stage":"exploratory" if any(self.records[k]["stage"]=="exploratory" for k in keys) else "frozen archive"})
        return rendered


def word_count(markdown):
    body = re.sub(r"^---\n.*?\n---\n", "", markdown, flags=re.S)
    body = re.sub(r"```.*?```", "", body, flags=re.S)
    body = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", body)
    return len(re.findall(r"[\w]+(?:[’'-][\w]+)*", body))


def lint_numbers(template):
    """Empirical numerals belong to a claim tag. Exempt only document metadata and identifiers."""
    prose = re.sub(r"^---\n.*?\n---\n", "", template, flags=re.S)
    prose = re.sub(r"```bibtex\n.*?```", "", prose, flags=re.S)
    prose = re.sub(r"\]\([^)]*\)", "]", prose)
    prose = TAG.sub("", prose)
    for identifier in ("Qwen2.5-0.5B-Instruct", "SmolLM2-360M-Instruct", "SmolLM2",
                       "Q4_K_M", "SHA-256", "Apache 2.0", "python3"):
        prose = prose.replace(identifier, "")
    if re.search(r"\d", prose):
        found = re.search(r"[^\s]*\d[^\s]*", prose).group(0)
        raise ValueError(f"Unsupported numeral in prose: {found}. Cite a data-field claim.")

def lint(markdown, name, minimum, maximum, publish):
    normalized = markdown.lower().replace("’", "'")
    for term in BANNED:
        if (term in normalized if term in ("—", "–") else re.search(r"\b" + re.escape(term) + r"\b", normalized)):
            raise ValueError(f"{name}: forbidden wording {term!r}")
    if TAG.search(markdown) or (publish and AUTHOR.search(markdown)):
        raise ValueError(f"{name}: unresolved placeholder")
    words = word_count(markdown)
    if not minimum <= words <= maximum:
        raise ValueError(f"{name}: {words} words; expected {minimum} to {maximum}")
    return words


def write_json(path, doc):
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def render_html(markdown, path, title, draft=False, meta=None, directory_index=False):
    proc = subprocess.run(["pandoc", "-f", "gfm", "-t", "html5", "--wrap=none"],
                          input=markdown, text=True, capture_output=True, check=True)
    body = re.sub(r"<a href=", '<a target="_blank" rel="noopener" href=', proc.stdout)
    title = html.escape(title)
    label = "<p class='draft'>Editorial draft</p>" if draft else ""
    if meta:
        label += "<p>" + html.escape(meta["date"] + " · " + str(meta["reading_minutes"]) + " min read · " + ", ".join(meta["tags"])) + "</p>"
    directory_base = ""
    if directory_index:
        # Both /blog/index.html and Vercel's /blog must resolve links against
        # /blog/. Keep any preview mount prefix and the current origin.
        directory_base = r"""<script>(()=>{const u=new URL(location.href);u.pathname=u.pathname.replace(/\/index(?:\.html)?\/?$/,"").replace(/\/$/,"")+"/";u.search="";u.hash="";const b=document.createElement("base");b.href=u.href;document.head.prepend(b)})();</script>"""
    path.write_text(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · PodBench</title>{directory_base}
<style>body{{margin:0;color:#223329;background:#fff}}main{{max-width:74ch;margin:2rem auto;padding:0 1.4rem;overflow-wrap:anywhere;font:1.08rem/1.63 Georgia,serif}}h1,h2,h3{{line-height:1.18}}h2{{margin-top:2rem}}a{{color:#165e47}}table{{display:block;max-width:100%;overflow:auto;border-collapse:collapse}}td,th{{border-bottom:1px solid #cad7cf;padding:.35rem;text-align:left}}img{{max-width:100%;height:auto}}pre{{overflow:auto;padding:.7rem;background:#f2f5f2}}.draft{{font:bold .85rem system-ui;color:#574256}}@media(prefers-color-scheme:dark){{:root{{color-scheme:dark}}body{{color:#e7efe9;background:#14201a}}a{{color:#a2d9bd}}pre{{background:#203228}}td,th{{border-color:#43574a}}.draft{{color:#e5cbea}}}}</style></head><body><main>{label}{body}</main></body></html>""")


def make_pdf(markdown, out):
    env = {**os.environ, "SOURCE_DATE_EPOCH":"1795525200", "FORCE_SOURCE_DATE":"1"}
    pdf_text = markdown.replace("](recovery-figure.png)", "](recovery-figure.pdf)").replace(
        "](claims.json)", "](" + PUBLIC + "claims.json)")
    subprocess.run(["pandoc", "--from=markdown+pipe_tables+implicit_figures", "--pdf-engine=xelatex",
        "--variable", "mainfont=Liberation Serif", "--variable", "geometry=margin=0.9in",
        "--variable", "fontsize=11pt", "--variable", "colorlinks=true",
        "--variable", r"header-includes=\setlength{\emergencystretch}{3em}",
        "--resource-path", str(ROOT / "docs"), "--metadata", "pagetitle=PodBench recovery",
        "--output", str(out / "paper.pdf")], input=pdf_text, text=True, env=env, check=True)


    # xdvipdfmx derives its PDF trailer ID from the temporary directory as well
    # as the creation date. Both hex strings have a fixed width, so using a
    # content-derived ID here preserves every byte offset in the PDF xref.
    path = out / "paper.pdf"
    data = path.read_bytes()
    identifier = hashlib.sha256(markdown.encode()).hexdigest()[:32].encode()
    trailer = b"/ID[<" + identifier + b"><" + identifier + b">]"
    data, count = re.subn(rb"/ID\[<[0-9a-fA-F]{32}><[0-9a-fA-F]{32}>\]", trailer, data)
    if count != 1:
        raise ValueError("Unexpected PDF trailer format from xdvipdfmx")
    path.write_bytes(data)


def frontmatter(markdown):
    block, body = markdown.split("---\n", 2)[1:]
    fields = dict(line.split(": ", 1) for line in block.strip().splitlines())
    fields.update({key:json.loads(fields[key]) for key in ("title","summary")})
    fields["tags"] = [tag.strip() for tag in fields["tags"][1:-1].split(",")]
    fields["reading_minutes"] = int(fields["reading_minutes"])
    if fields["status"] not in ("draft", "published") or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fields["date"]):
        raise ValueError("A dated draft or published post is required.")
    return fields, body


def manuscript_parts(source):
    """One upstream document owns the paper, PDF and standalone executive summary."""
    opening = "<!-- executive-summary -->"
    closing = "<!-- /executive-summary -->"
    if source.count(opening) != 1 or source.count(closing) != 1:
        raise ValueError("Provide exactly one marked executive summary")
    main, tail = source.split(opening)
    summary, after = tail.split(closing)
    return (main.rstrip() + "\n" + after.lstrip(), summary.strip() + "\n")


def post_templates(folder):
    for path in sorted(folder.glob("*.md.in")):
        slug=path.name.removesuffix(".md.in")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*",slug):
            raise ValueError("Unsupported post slug: "+slug)
        yield slug,path


def blog_files(posts, out):
    items = "\n".join(f"- **{p['status'].title()}** [{p['title']}]({p['slug']}.html) · {p['date']} · {p['reading_minutes']} min. {p['summary']}" for p in posts)
    index = "# Research notes\n\n" + items + "\n\n[RSS feed for published posts](feed.xml)\n"
    render_html(index, out / "blog/index.html", "Research notes", directory_index=True)
    feed = ET.Element("rss",version="2.0")
    channel = ET.SubElement(feed,"channel")
    for key,value in {"title":"PodBench research notes", "link":PUBLIC+"blog/index.html",
                      "description":"Published field notes on agent recovery."}.items():
        ET.SubElement(channel,key).text=value
    for post in posts:
        if post["status"] == "published":
            item = ET.SubElement(channel,"item")
            link = PUBLIC + post["html"]
            stamp = datetime.fromisoformat(post["date"]).replace(tzinfo=timezone.utc)
            for key,value in {"title":post["title"],"link":link,"guid":link,"description":post["summary"],
                              "pubDate":format_datetime(stamp, usegmt=True)}.items():
                ET.SubElement(item,key).text=value
    ET.ElementTree(feed).write(out / "blog/feed.xml",encoding="utf-8", xml_declaration=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--check", action="store_true", help="rebuild in isolation and verify the committed outputs")
    parser.add_argument("--publish", action="store_true",
                        help="require completed measured sections and reject editorial placeholders")
    args = parser.parse_args()
    destination = args.output.resolve()
    temporary = tempfile.TemporaryDirectory() if args.check else None
    out = Path(temporary.name) if temporary else destination
    (out/"blog").mkdir(parents=True,exist_ok=True)
    for name, expected in json.loads((HERE / "frozen-inputs.json").read_text()).items():
        if read_input(name)[1] != expected:
            raise ValueError(f"Frozen source digest mismatch: {name}")
    claims = Claims()
    from measured import measured_sections
    sections, pending = measured_sections(claims, ROOT)
    if pending and args.publish:
        raise ValueError("Pending evidence: " + ", ".join(pending))
    def article(text, name):
        for key,value in sections.items():
            text = text.replace("{{"+key+"}}",value)
        lint_numbers(text)
        return claims.render(text,name)
    source, summary_source = manuscript_parts((HERE / "paper.md.in").read_text())
    paper = article(source, "paper")
    brief = article(summary_source, "summary")
    paper_words = lint(paper, "paper", 3000, 4500, args.publish)
    brief_words = lint(brief, "summary", 300, 400, args.publish)
    (out/"paper.md").write_text(paper)
    (out/"summary.md").write_text(brief)
    shutil.copyfile(ROOT/"docs/recovery-figure.png", out/"recovery-figure.png")
    title = paper.splitlines()[0][2:]
    render_html(paper, out/"paper.html",title)
    render_html(brief, out/"summary.html", "Recovery study summary")
    posts=[]
    for slug, template in post_templates(HERE / "posts"):
        initial = template.read_text().replace("{{read_time}}","1")
        for key,value in sections.items():
            initial = initial.replace("{{"+key+"}}",value)
        lint_numbers(initial)
        md = claims.render(initial,slug)
        words = lint(md, slug, 500, 900, args.publish)
        reading = math.ceil(words/200)
        md = md.replace("reading_minutes: 1\n",f"reading_minutes: {reading}\n",1)
        meta,body=frontmatter(md)
        if meta["status"] == "published" and AUTHOR.search(md):
            raise ValueError(f"{slug}: placeholder in published post")
        path = "blog/"+slug
        (out/(path+".md")).write_text(md)
        render_html(body,out/(path+".html"),meta["title"],meta["status"]=="draft",meta)
        posts.append(dict(**meta,slug=slug,words=words,placeholders=AUTHOR.findall(md),markdown=path+".md",html=path+".html"))
    posts.sort(key=lambda p:p["date"], reverse=True)
    blog_files(posts,out)
    from qualitative import qualitative_checks
    findings = qualitative_checks(read_input, evidence, claims.records)
    write_json(out/"claims.json", {"schema_version":2,"claims":claims.records,"passages":claims.passages,"qualitative_claims":findings})
    make_pdf(paper,out)
    summary = "A paired experiment in database recovery, followed by exploratory analysis of agent decisions."
    paper_meta = dict(title=title, summary=summary, markdown="paper.md", pdf="paper.pdf", html="paper.html",
                      executive_summary="summary.md", executive_summary_html="summary.html", summary_html="summary.html",
                      words=paper_words, summary_words=brief_words, status="research draft")
    write_json(out/"index.json", {"schema_version":1,"paper":paper_meta,"posts":posts,
               "claims":"claims.json","pending_data":pending,"placeholder_count":sum(len(p["placeholders"]) for p in posts),"blog":"blog/index.html","rss":"blog/feed.xml"})
    if args.check:
        expected = {f.relative_to(out) for f in out.rglob("*") if f.is_file()}
        actual = {f.relative_to(destination) for f in destination.rglob("*") if f.is_file()}
        if expected != actual:
            raise ValueError(f"Generated file set mismatch: {expected ^ actual}")
        for key in sorted(expected):
            if (destination/key).read_bytes() != (out/key).read_bytes():
                raise ValueError(f"Stale generated artifact: {key}")
        temporary.cleanup()
    print(f"Verified {len(claims.records)} numeric claims. Paper {paper_words} words, summary {brief_words}.")
    print("Posts:", ", ".join(f"{p['slug']} {p['words']} ({p['status']})" for p in posts))
    placeholders = [(p["slug"], match) for p in posts for match in p["placeholders"]]
    print("Editorial placeholders:", placeholders if placeholders else "none")


if __name__ == "__main__":
    main()
