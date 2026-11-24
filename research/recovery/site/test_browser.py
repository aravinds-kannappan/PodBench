"""Render the committed static site, navigate its pages and check real archived data.

Run with Python Playwright and its Chromium browser installed. Set CHROMIUM_PATH
to use a system Chromium binary. Requests are fulfilled from public/ in memory.
"""
import json
import mimetypes
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from playwright.sync_api import sync_playwright

PUBLIC = Path(__file__).resolve().parent / "public"
ORIGIN = "https://podbench.test"
PAGES = ("home", "what-changed", "instruction-explainer", "trajectory",
         "failure-taxonomy", "probes", "expert-review", "paper-summary", "paper",
         "blog", "methods")


def serve(route):
    url = urlparse(route.request.url)
    if url.hostname != "podbench.test":
        route.abort()
        return
    request_path = unquote(url.path.removeprefix("/recovery/").lstrip("/")) or "index.html"
    path = (PUBLIC / request_path).resolve()
    if path.is_relative_to(PUBLIC) and path.is_dir():
        path = path / "index.html"
    if not path.is_relative_to(PUBLIC) or not path.is_file():
        route.fulfill(status=404, body="Missing local file")
        return
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    route.fulfill(body=path.read_bytes(), content_type=mime)


def wait_page(page):
    page.wait_for_function("document.querySelector('main').getAttribute('aria-busy') === 'false' && document.querySelector('main').dataset.fragment === location.hash")
    assert not page.get_by_role("alert").count(), page.locator("main").inner_text()
    assert page.locator("main h1").count() == 1
    assert "undefined" not in page.locator("main").inner_text()
    assert "NaN" not in page.locator("main").inner_text()


def go(page, path):
    page.goto(ORIGIN + "/index.html#" + path)
    wait_page(page)


def check_rank_sort(page, heading):
    board = page.locator("main table").first
    header = board.get_by_role("columnheader", name="Sort by " + heading, exact=True)
    button = header.get_by_role("button")
    row_text = lambda: board.locator("tbody tr").all_inner_texts()
    before = row_text()
    column = header.evaluate("th => th.cellIndex")
    fractions = board.locator("tbody tr").evaluate_all(
        "(rows, col) => rows.map(r => r.cells[col].textContent.split(' ')[0].split('/').map(Number))", column
    )
    ordered = sorted(zip(before, fractions), key=lambda item: item[1][0] / item[1][1], reverse=True)
    button.focus()
    button.press("Enter")
    assert header.get_attribute("aria-sort") == "descending"
    assert header.locator(".sort-arrow").text_content() == "↓"
    assert row_text() == [row for row, _ in ordered]
    button.press("Space")
    assert header.get_attribute("aria-sort") == "ascending"
    assert header.locator(".sort-arrow").text_content() == "↑"
    assert row_text() == [row for row, _ in sorted(zip(before, fractions), key=lambda item: item[1][0] / item[1][1])]
    assert board.locator("[aria-sort]").count() == 1
    assert button.evaluate("b => b === document.activeElement")


def contrast(left, right):
    def luminance(rgb):
        components = [int(v) / 255 for v in re.findall(r"\d+", rgb)[:3]]
        linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in components]
        return sum(weight * c for weight, c in zip((0.2126, 0.7152, 0.0722), linear, strict=True))
    dark, light = sorted((luminance(left), luminance(right)))
    return (light + 0.05) / (dark + 0.05)


def verify_schemes(page):
    backgrounds = set()
    for scheme in ("dark", "light"):
        page.emulate_media(color_scheme=scheme)
        go(page, "home")
        colors = page.evaluate("""() => {
            const css = selector => getComputedStyle(document.querySelector(selector));
            const header = css('thead th'), body = css('body'), panel = css('.panel'), select = css('select'), badge = css('.badge');
            return {scheme:css(':root').colorScheme, body:[body.color,body.backgroundColor],
              heading:[header.color,header.backgroundColor],select:[select.color,select.backgroundColor],
              badge:[badge.color,badge.backgroundColor], data:[css('.chart svg rect').fill,panel.backgroundColor]};
        }""")
        assert colors["scheme"] == scheme
        backgrounds.add(colors["body"][1])
        for part in ("body", "heading", "select", "badge", "data"):
            assert contrast(*colors[part]) >= (3 if part == "data" else 4.5), (scheme, part, colors[part])
        go(page, "instruction-explainer")
        shades = page.locator(".heat").evaluate_all("""cells => cells.map(cell => {
          const s = getComputedStyle(cell); return [s.color, s.backgroundColor]
        })""")
        assert shades and all(contrast(*pair) >= 4.5 for pair in shades), (scheme, set(map(tuple, shades)))
    assert len(backgrounds) == 2


def main():
    frozen = json.loads((PUBLIC / "data/frozen.json").read_text())
    summary = json.loads((PUBLIC / "data/summary.json").read_text())
    archive = json.loads((PUBLIC / "data/episodes.json").read_text())
    probes = json.loads((PUBLIC / "data/probes.json").read_text())
    assert archive and len(archive) == frozen["totals"]["recorded"]
    errors = []
    with sync_playwright() as pw:
        launch = dict(headless=True)
        if os.environ.get("CHROMIUM_PATH"):
            launch["executable_path"] = os.environ["CHROMIUM_PATH"]
        browser = pw.chromium.launch(**launch)
        context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        context.route("**/*", serve)
        page = context.new_page()
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        for path in PAGES:
            go(page, path)
            for panel in page.locator("main .panel").all():
                assert panel.locator(":scope > .panel-head > .badge").count() == 1
            for figure in page.locator("main .chart").all():
                assert figure.locator("figcaption").count() == 1
            for graph in page.locator("main svg").all():
                assert graph.get_attribute("aria-label")
            for view in page.locator("main iframe").all():
                assert view.get_attribute("title") and view.get_attribute("sandbox") is not None

        for path in ("instruction-explainer", "what-changed", "failure-taxonomy", "probes"):
            go(page, path)
            for select in page.locator("main select").all():
                keys = select.locator("option").evaluate_all("items => items.map(item => item.value)")
                if len(keys) > 1:
                    select.select_option(keys[-1])
            assert "undefined" not in page.locator("main").inner_text()
            assert "NaN" not in page.locator("main").inner_text()
        go(page, "what-changed")
        first_lost = [r for r in archive if r["first_unreachable_submission"] == 1]
        assert f"{len(first_lost)} episodes lost" in page.locator("main").inner_text()
        note = next(v for v in probes["blackbox"]["variants"] if v["id"] == "handoff_note")
        matched = page.get_by_role("table", name="Immediate submission with and without the note")
        for row, stats in zip(matched.locator("tbody tr").all(), note["by_model"].values(), strict=True):
            submit = stats["first_actions"].get("submit", {})
            assert row.locator("td").all_inner_texts()[:2] == [f"{submit.get(side, 0)}/{stats['n']}" for side in ("control", "treatment")]
        page.get_by_role("link", name="Compare instruction-conflict interventions").click()
        page.wait_for_url("**#probes?*")
        wait_page(page)
        assert page.get_by_label("Intervention family").input_value() == "instruction_conflict"
        assert page.get_by_label("Outcome", exact=True).input_value() == "action:submit"
        go(page, "instruction-explainer")
        assert page.locator('main a[href*="mechanism/explain-"]').count() == 5

        go(page, "home")
        assert page.locator("main table").first.locator("tbody tr").count() == len(frozen["by_model"]) * 2
        check_rank_sort(page, "Invalid decisions")
        page.get_by_role("button", name="Exploratory reanalysis").click()
        page.wait_for_url("**#home?view=exploratory")
        wait_page(page)
        assert page.locator("main table").first.locator("tbody tr").count() == len(summary["groups"])
        rebuilt = page.locator("main table").first.locator("tbody tr")
        for row, source in zip(rebuilt.all(), summary["groups"], strict=True):
            cells = row.locator("th,td").all_inner_texts()
            assert cells[3:7] == [f"{source[field]}/{source['n']}" for field in ("first_inspection", "submitted", "exact_state", "passed")]
        check_rank_sort(page, "Inspected first")
        loaded = []
        page.on("request", lambda req: loaded.append(urlparse(req.url).path))
        page.reload()
        wait_page(page)
        assert "/data/summary.json" in loaded and "/data/frozen.json" not in loaded
        assert page.get_by_role("button", name="Exploratory reanalysis").get_attribute("aria-pressed") == "true"

        example = next(r for r in archive if r["first_unreachable_submission"] is not None)
        raw = json.loads((PUBLIC / example["url"]).read_text())
        turn = raw["steps"][-1]
        go(page, "trajectory?id=" + quote(example["id"]) + "&turn=" + str(turn["turn"]))
        assert page.get_by_role("heading", name="Decision " + str(turn["turn"]), exact=True).count()
        assert page.get_by_role("link", name="Download episode JSON").get_attribute("href") == example["url"]
        reply = page.get_by_role("heading", name="Raw reply").locator("+ pre").text_content()
        assert reply == (turn["reply"] if turn["reply"] is not None else "(No reply received)")
        assert page.locator("main .chart-data").count()
        page.locator("main .chart-data summary").first.click()
        with page.expect_download() as download:
            page.get_by_role("button", name="Download chart CSV").first.click()
        assert download.value.suggested_filename.endswith(".csv")

        go(page, "expert-review")
        assert page.get_by_role("link", name="Open the masked review workspace").get_attribute("href") == "review/index.html"
        go(page, "blog")
        page.get_by_role("link", name="Read post", exact=True).first.click()
        page.wait_for_selector("main iframe")
        wait_page(page)
        assert parse_qs(urlparse(page.url).fragment.partition("?")[2]).get("post")

        for entry, destination in (("/blog", "/#blog"), ("/recovery/blog", "/recovery/index.html#blog"),
                                   ("/recovery/blog/index.html", "/recovery/index.html#blog")):
            page.goto(ORIGIN + entry)
            page.wait_for_url(ORIGIN + destination)
            wait_page(page)
            assert page.get_by_role("heading", name="Research blog").count() == 1

        page.set_viewport_size({"width": 375, "height": 800})
        for path in PAGES:
            go(page, path)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), f"Mobile overflow: {path}"
        page.locator(".mobile-menu summary").click()
        page.locator("#all-nav").get_by_role("link", name="Leaderboard").click()
        wait_page(page)
        assert page.locator(".mobile-menu").get_attribute("open") is None
        verify_schemes(page)
        assert not errors, errors
        browser.close()
    print("Verified all 11 routes, readouts, local downloads, deep links, scope labels and narrow-screen layout.")


if __name__ == "__main__":
    main()
