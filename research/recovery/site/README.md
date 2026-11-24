# Publish the recovery study on Vercel

This project is a static website. Its committed HTML, browser JavaScript, figures, transcripts, annotation interface and study data live in `public/`. Charts run locally in the browser. The annotation form stores records on the reviewer's device. Hash routes such as `index.html#trajectory?id=EPISODE_ID&turn=2` survive a hard refresh, including on preview branches. The browser loads one transcript at a time.

## Deploy

1. Import `aravinds-kannappan/PodBench` into a Vercel project. Select the study branch or commit for preview and `main` for production.
2. Set **Root Directory** to `research/recovery/site` and **Framework Preset** to **Other**.
3. Set **Install Command** to an empty override. Set **Build Command** to `node build.mjs` and **Output Directory** to `public`. The included `vercel.json` supplies the same values. There are no package dependencies or environment variables.
4. Deploy. Review the leaderboard, switch to Exploratory, open a trajectory and refresh its URL. The selected episode and turn should remain selected. For an unknown file path the standalone deployment serves `404.html`.
5. From a checkout of the deployed commit, run `python3 research/recovery/site/verify_public.py https://YOUR-PROJECT.vercel.app`. It checks the SHA-256 digest of every public file against the release manifest. For a quick check, append `data/frozen.json data/summary.json data/probes.json data/integrity.json` to the command. The integrity file records the frozen journal digest and the hashes used for every site data file.

The repository's existing Vercel dashboard also serves these committed static files at `/recovery/index.html`. The settings above deploy the recovery study on its own, with no functions, database connections or analytics. Use the standalone project root for a dedicated static deployment.

## Refresh the data locally

The release PDF was typeset with Pandoc 3.1.11.1, XeTeX 0.999996 (TeX Live 2025/dev/Debian) and Liberation Serif. Use those versions when comparing PDF bytes across computers. Vercel verifies the committed release with Node.

Build the mechanism outputs from the [exploratory study guide](../mechanism/README.md). From the repository root, run `python3 research/recovery/site/make_site_data.py` to regenerate the static site data, then run it with `--check` for an independent comparison. Normal site builds verify the generated release using Node. Vercel does not run Python, collect episodes, or load model weights.
