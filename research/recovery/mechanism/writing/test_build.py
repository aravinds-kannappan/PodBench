import unittest
from unittest.mock import patch
from pathlib import Path
import tempfile
from build import lint, lint_numbers, manuscript_parts, post_templates, render_html


class EditorialChecks(unittest.TestCase):
    def test_new_posts_are_discovered(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"example-post.md.in"
            path.write_text("# A later draft")
            self.assertEqual(list(post_templates(Path(folder))),[("example-post",path)])

    def test_executive_summary_is_extracted_once(self):
        text="# Paper\n\nBody.\n<!-- executive-summary -->\n# Brief\nA.\n<!-- /executive-summary -->"
        self.assertEqual(manuscript_parts(text),("# Paper\n\nBody.\n","# Brief\nA.\n"))
        with self.assertRaises(ValueError):
            manuscript_parts(text+text)

    def test_standalone_post_metadata(self):
        meta={"date":"2026-11-24","reading_minutes":3,"tags":["recovery","SQL"]}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"note.html"
            with patch("build.subprocess.run") as pandoc:
                pandoc.return_value.stdout = "<p>Body</p>"
                render_html("Body",path,"Note",draft=True,meta=meta)
            html=path.read_text()
            self.assertIn("Editorial draft",html)
            self.assertIn("2026-11-24 · 3 min read · recovery, SQL",html)
            self.assertNotIn("<script",html)

    def test_unsupported_number(self):
        for body in ("Of the records 90917 were invalid.", "Exactly [90917](https://example.org) passed."):
            with self.assertRaisesRegex(ValueError, "Unsupported numeral"):
                lint_numbers(body)

    def test_claim_tag_and_model_identity(self):
        lint_numbers("SmolLM2 passed {{sg_passed}}/{{sg_scheduled}}. [License](https://example.org/apache/2).")

    def test_prohibited_wording(self):
        for body in ("Delve into the result.", "Measured—again.", "Measured–again."):
            with self.assertRaisesRegex(ValueError, "forbidden wording"):
                lint(body, "post", 1, 10, False)

    def test_editorial_marker(self):
        text = "A draft. [AUTHOR: check professional biography]"
        lint(text, "draft", 1, 20, False)
        with self.assertRaisesRegex(ValueError,"placeholder"):
            lint(text, "public", 1, 20, True)


if __name__ == "__main__":
    unittest.main()
