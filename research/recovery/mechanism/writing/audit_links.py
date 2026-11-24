"""Audit source and document links. --network makes GET requests to external primary references."""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

from build import HERE, ROOT, OUT, MECHANISM_RELEASE

REPO = "https://github.com/aravinds-kannappan/PodBench/"
# The GitHub release is a citation target in BibTeX rather than a Markdown link.
RELEASE = REPO + "releases/tag/recovery-v1.0.0"


def test_url(url):
    try:
        request = urllib.request.Request(url, headers={"User-Agent":"PodBench-reference-check/1.0"})
        with urllib.request.urlopen(request,timeout=35) as reply:
            content = reply.read(800000).decode("utf-8",errors="replace")
            model_card = url.startswith("https://huggingface.co/")
            info = {"url":url,"status":reply.status,"final_url":reply.geturl(),"ok":200 <= reply.status < 400}
            if model_card:
                info["apache_2_0_label_present"] = "apache-2.0" in content.lower()
                info["ok"] = info["ok"] and info["apache_2_0_label_present"]
            return info
    except (urllib.error.URLError,OSError) as error:
        return {"url":url,"ok":False,"error":str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", action="store_true")
    args=parser.parse_args()
    external={RELEASE}
    repo_targets=set()
    generated=set()
    for md in [OUT/"summary.md",OUT/"paper.md",*sorted((OUT/"blog").glob("*.md"))]:
        for url in re.findall(r"\]\(([^\s)]+)\)",md.read_text()):
            if url.startswith(REPO):
                repo_targets.add(url)
            elif url.startswith("https://"):
                external.add(url)
            elif "://" in url:
                raise ValueError(f"Unexpected link {url} in {md}")
            else:
                local=(md.parent/url.partition("#")[0]).resolve()
                if not local.is_file():raise FileNotFoundError(local)
                generated.add(str(local.relative_to(ROOT)))
    checked=[]
    for url in sorted(repo_targets):
        route, revision, path = url.removeprefix(REPO).split("/",2)
        if route not in ("blob","tree"):raise ValueError(f"Unsupported repository url {url}")
        path=urllib.parse.unquote(path.partition("#")[0])
        upcoming = revision == MECHANISM_RELEASE and subprocess.run(
            ["git","rev-parse","--verify","--quiet","refs/tags/"+revision],cwd=ROOT,capture_output=True).returncode != 0
        if revision=="main" or upcoming:
            if not (ROOT/path).exists():raise FileNotFoundError(path)
            method="local path for upcoming release" if upcoming else "local working tree"
        else:
            subprocess.run(["git","cat-file","-e",revision+":"+path],cwd=ROOT,check=True)
            method="pinned local git object"
        checked.append({"url":url,"method":method,"ok":True})
    if args.network:
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            primaries=list(pool.map(test_url,sorted(external)))
        record={"checked_at":datetime.now(timezone.utc).isoformat(),"external":primaries,"repo":checked,"generated":sorted(generated)}
        (HERE/"link-audit.json").write_text(json.dumps(record,indent=2)+"\n")
        failures = [item["url"] for item in primaries if not item["ok"]]
        print("External HTTP checks",len(primaries),"failures",failures)
        if failures:
            raise SystemExit("One or more reference checks failed.")
    else:
        print("External GET checks skipped. Use --network to repeat.")
    print("Repository links verified via path/object",len(checked),"local generated files",len(generated))


if __name__=="__main__":
    main()
