// Verify committed static data. Vercel runs this check without a package install.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = dirname(fileURLToPath(import.meta.url));
const root = resolve(site, "../../..");
const pub = resolve(site, "public");
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const load = path => JSON.parse(readFileSync(path, "utf8"));
const lock = load(resolve(pub, "data/integrity.json"));

function verify(base, entries) {
  for (const [name, digest] of Object.entries(entries)) {
    const path = resolve(base, name);
    if (sha(path) !== digest) throw new Error("Stale release file " + name);
  }
}
verify(resolve(pub, "data"), lock.files);
if (existsSync(resolve(root, "research/recovery/episodes.jsonl"))) verify(root, lock.sources);
const published = load(resolve(site, "public-lock.json"));
verify(pub, published.files);
if (existsSync(resolve(root, "research/recovery/episodes.jsonl"))) verify(root, published.inputs);
for (const name of ["index.html", "404.html", "data/frozen.json", "data/summary.json", "data/probes.json", "review/index.html", "writing/index.json"]) {
  if (!existsSync(resolve(pub, name))) throw new Error("Missing site artifact " + name);
}
console.log("Verified " + Object.keys(published.files).length + " static release files.");
