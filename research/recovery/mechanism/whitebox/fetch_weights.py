"""Fetch original HF artifacts and verify file sizes and content digests."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent


def verify(path, spec):
    if not path.is_file() or path.stat().st_size != spec['size']:
        return False
    if 'sha256' in spec:
        h, expected = hashlib.sha256(), spec['sha256']
    else:
        h, expected = hashlib.sha1(f"blob {spec['size']}\0".encode()), spec['git_blob_sha1']
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 << 20), b''):
            h.update(block)
    return h.hexdigest() == expected


def fetch(job):
    path, url, spec = job
    if verify(path, spec):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.part')
    with urlopen(url, timeout=300) as stream, temp.open('wb') as out:
        shutil.copyfileobj(stream, out, 4 << 20)
    if not verify(temp, spec):
        raise ValueError(f"Size/digest mismatch for {path}")
    temp.replace(path)
    print(f"Verified {path}", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("directory", type=Path)
    args = p.parse_args()
    specs = json.loads((HERE / "weights.json").read_text())
    jobs = [(args.directory / key / name, f"https://huggingface.co/{s['repo_id']}/resolve/{s['revision']}/{name}?download=true", spec)
            for key, s in specs.items() for name, spec in s['files'].items()]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch, jobs))


if __name__ == "__main__":
    main()
