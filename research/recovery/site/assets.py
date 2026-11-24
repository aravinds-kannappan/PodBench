"""Make content-addressed browser assets for the static research site."""

import hashlib
import re
from pathlib import Path


def assets(site):
    public = site / "public"
    template = (site / "index.html.in").read_text()
    assets_dir = public / "assets"

    def block(match):
        filename = match.group(2)
        digest = hashlib.sha256((assets_dir / filename).read_bytes()).hexdigest()[:16]
        name = f"{Path(filename).stem}.{digest}{Path(filename).suffix}"
        outputs["assets/" + name] = (assets_dir / filename).read_bytes()
        return match.group(1) + "./assets/" + name + '"'

    outputs = {}
    document = re.sub(r'(href="|src=")\./assets/([\w-]+\.(?:js|css))"', block, template)
    if not outputs:
        raise ValueError("Missing local assets in the site template")
    outputs["index.html"] = document.encode()
    return outputs


def apply(site, check):
    public = site / "public"
    expected = assets(site)
    for name, content in expected.items():
        dest = public / name
        if check:
            if not dest.exists() or dest.read_bytes() != content:
                raise ValueError(f"Stale generated browser asset: {name}")
        else:
            dest.write_bytes(content)
    for f in (public / "assets").iterdir():
        if (
            re.fullmatch(r"[\w-]+\.[a-f0-9]{16}\.(?:css|js)", f.name)
            and "assets/" + f.name not in expected
        ):
            if check:
                raise ValueError(f"Obsolete generated browser asset: {f.name}")
            f.unlink()
