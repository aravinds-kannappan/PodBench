"""Optional headless browser round-trip. All test ratings stay in an isolated browser context."""
import json
import shutil
import threading
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from tempfile import TemporaryDirectory
from pathlib import Path

from generate import PUBLIC
from agreement import read_annotations

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


class StaticServer(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/review":
            self.path = "/review/index.html"
        super().do_GET()

    def log_message(self, format, *args):
        pass


@unittest.skipUnless(sync_playwright and shutil.which("chromium") and (PUBLIC / "kit.json").exists(),
                     "optional browser test needs Playwright, Chromium and the generated public kit")
class TestReviewUI(unittest.TestCase):
    def test_local_annotation_reload_and_export(self):
        handler = partial(StaticServer, directory=str(PUBLIC.parent))
        try:
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        except PermissionError:
            self.skipTest("browser smoke test needs permission to bind a loopback HTTP port")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as runner, TemporaryDirectory() as tmp:
                browser = runner.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
                page = browser.new_page(viewport={"width":390,"height":840})
                url = f"http://127.0.0.1:{server.server_port}/review"
                for target in (url + "/index.html", url):
                    page.goto(target)
                    page.locator("#open:enabled").wait_for()
                    self.assertGreater(page.locator("#case option").count(), 0)
                page.locator("#reader").fill("test-annotator")
                page.locator("#open").click()
                chosen_case = page.locator("#case").input_value()
                page.locator("#rate-evidence").select_option("indeterminate")
                page.locator("#next").click()
                page.locator("#previous").click()
                self.assertEqual(page.locator("#rate-evidence").input_value(), "indeterminate")
                page.reload()
                page.locator("#reader").fill("test-annotator")
                page.locator("#open").click()
                self.assertEqual(page.locator("#rate-evidence").input_value(), "indeterminate")
                with page.expect_download() as download:
                    page.locator("#export").click()
                snapshot = Path(tmp) / "test-export.json"
                download.value.save_as(snapshot)
                kit = json.loads((PUBLIC / "kit.json").read_text())
                parsed = read_annotations([snapshot], kit)
                self.assertEqual(parsed, {"test-annotator": {chosen_case: {"evidence": "indeterminate"}}})
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
