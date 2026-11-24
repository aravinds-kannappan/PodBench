"""Check the public static release against a local checkout, including each trajectory."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import urljoin
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SITE = Path(__file__).resolve().parent


def verify(base, files):
    lock = json.loads((SITE / "public-lock.json").read_bytes())

    def fetch(pair):
        path, expected = pair
        req = Request(
            urljoin(base.rstrip("/") + "/", path) + "?sha256=" + expected[:12],
            headers={"User-Agent": "PodBench-release-verifier/1"},
        )
        for attempt in range(3):
            try:
                with urlopen(req, timeout=30) as result:
                    actual = hashlib.sha256(result.read()).hexdigest()
                break
            except HTTPError as exc:
                if attempt == 2 or (exc.code != 429 and exc.code < 500):
                    raise
            except (TimeoutError, URLError):
                if attempt == 2:
                    raise
            time.sleep(2**attempt)
        if actual != expected:
            raise ValueError(f"Digest mismatch for {path}: {actual} != {expected}")
        return path

    items = (
        lock["files"].items() if not files else [(f, lock["files"][f]) for f in files]
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        verified = list(pool.map(fetch, items))
    print(f"Verified {len(verified)} live files against the local SHA-256 manifest.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("base", help="Vercel origin or static subdirectory")
    p.add_argument(
        "files",
        nargs="*",
        help="Optional relative file paths. Default checks the entire release.",
    )
    args = p.parse_args()
    verify(args.base, args.files)
