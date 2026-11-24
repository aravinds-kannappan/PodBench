// Match text lengths with local tokenization only. No generation or logits.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { getLlama } = await import(pathToFileURL(createRequire(import.meta.url).resolve("node-llama-cpp")));
const root = new URL("./", import.meta.url);
const design = JSON.parse(await readFile(new URL("design.json", root)));
const [qwen, smol] = process.argv.slice(2);
if (!qwen || !smol) throw Error("Supply the two GGUF paths in Qwen, SmolLM2 order.");
const llama = await getLlama({gpu:false, build:"never", logLevel:"error"});
const fillers = ["red","blue","tan","gold","silver","moss","amber","mint","aqua","navy","grey","ochre","green","cream","coral","pink","indigo","lavender","ivory","violet","orange","burgundy","cherry","gray","peach","copper","teal","yellow","brown","pink quartz","warm grey","deep blue"];
let state = 20261124;
function pick(items) { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return items[Math.floor(state / 2**32 * items.length)]; }
const card = {};
try {
 for (const [idx, modelPath] of [qwen, smol].entries()) {
  const model = await llama.loadModel({modelPath, gpuLayers:0});
  const matched = [];
  for (const text of design.paraphrases) {
    // Both arms use the same sentence after the unchanged system prefix.
    const context = part => "with exactly one action name from the displayed menu and nothing else. " + part;
    const target = model.tokenize(context(text)).length;
    let found;
    for (let attempt = 0; attempt < 200000 && !found; attempt++) {
      const nouns = ["chair","paintings","curtains","pottery","furniture","ceramics","prints","frames","tiles","carpets","ornaments","sculptures","bowls","glass","vases","postcards","lanterns"];
      const subjects = ["The gallery","The museum","The exhibition","The collection","The room","The display","A shelf","This painting","The shop"];
      const verbs = ["includes","shows","contains","features","holds","has","displays"];
      let line = pick(subjects) + " " + pick(verbs) + " " + pick(fillers) + " " + pick(nouns);
      while (line.length < text.length - 1) {
        line += pick([", "," and "," or "," beside "," alongside "," near "," with "]) + pick(fillers) + " " + pick(nouns);
      }
      line += ".";
      if (line.length === text.length && model.tokenize(context(line)).length === target) found = line;
    }
    if (!found) throw Error("Unable to match placebo for " + text);
    matched.push({active:text, placebo:found, characters:text.length, system_tail_tokens:target});
  }
  card[design.models[idx]] = matched;
  await model.dispose();
 }
} finally { await llama.dispose(); }
await writeFile(new URL("placebos.json", root), JSON.stringify(card,null,2)+"\n");
