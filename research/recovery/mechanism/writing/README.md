# Rebuilding the recovery manuscript and editorial drafts

Run from the repository root with Python 3.10+, Pandoc and XeLaTeX installed. The PDF uses Liberation Serif. The current paper, executive summary, public claim register, six draft previews and RSS file are under `research/recovery/site/public/writing/`. The package uses no network access during generation.

```sh
python3 research/recovery/mechanism/writing/build.py --publish
python3 research/recovery/mechanism/writing/build.py --publish --check
python3 -m unittest discover -s research/recovery/mechanism/writing -p 'test_build.py'
python3 research/recovery/mechanism/writing/audit_links.py
```

The first command reads the primary manuscript template, including its explicitly delimited executive-summary block, and discovers every Markdown post template. It binds numerical claims to source fields and writes the rendered documents. The second rerenders in a temporary directory and compares every output byte, including the PDF trailer's deterministic content identifier. For a working draft while a study export is pending, omit `--publish`. The strict mode requires the study exports and refuses unresolved editorial placeholders. It preserves the draft status of individual posts.

## Numeric claims and links

Use a `{{claim_id}}` token for an empirical number. Add a source path and JSON pointer or a named, supported aggregation to `claims-spec.json`. Exploratory text joined across several outputs lives in `measured.py`. Each rendered number links directly to its data source. In `claims.json`, each key records its unrounded value, source digest, pointer or aggregation, citation URL, and the documents in which it appears. The register also contains the full measured passages and a separate set of qualitative findings. Those findings execute checks on matched prompts and replies, endpoint counts, ordered action sequences, reference policy behavior and reachable states. The checker rejects unbound digits in prose. Identifiers for models, formats and licenses are explicitly allowed. The frozen source files must also match the checksums in `frozen-inputs.json`.

Run `audit_links.py --network` to repeat external GET checks. It also verifies the Apache 2.0 label on each original model card. Repository links are resolved against pinned Git objects or the current checkout. Generated relative links must resolve under the writing bundle. The dated results distinguish those local checks from external HTTP responses.

## Editing and publishing the posts

Edit the appropriate Markdown template in `posts/`. Keep its title, ISO date, summary, tags and `status` in front matter. Reading time is computed from the rendered word count at 200 words per minute. The index records each post's word count and remaining author placeholders. The blog index exposes clearly labeled draft previews. The RSS feed includes only posts marked `status: published`.

To publish a reviewed post, change its status from `draft` to `published` in the template and rerun the strict build. A published post cannot contain a marker of the form `[AUTHOR: ...]`. The strict build flags such markers anywhere in the editorial package. Paper, summary and individual post pages contain no scripts or remote image dependencies and support the reader’s preferred color scheme. A small script on the standalone blog index resolves sibling links relative to its directory under both literal and clean URLs. PDF and HTML are generated from the same bound Markdown.
