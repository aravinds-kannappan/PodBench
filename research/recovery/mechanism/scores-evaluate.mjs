// Teacher-force the pinned ChatML prefix and each offered continuation on CPU.
// Usage: NODE_PATH=... node scores-evaluate.mjs MODEL WEIGHTS INPUT.jsonl OUTPUT.jsonl
import { createReadStream, readFileSync, appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [alias, modelPath, inputFile, output, mode = "candidates"] = process.argv.slice(2);
if (!output || !["candidates", "greedy", "branch-audit"].includes(mode)) {
  throw new Error("Expected MODEL WEIGHTS INPUT.jsonl OUTPUT.jsonl [candidates|greedy|branch-audit]");
}
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
const meta = manifest.models[alias];
if (!meta) throw new Error("Unknown checkpoint " + alias);
const digest = createHash("sha256");
for await (const data of createReadStream(modelPath)) digest.update(data);
if (digest.digest("hex") !== meta.sha256) throw new Error("GGUF does not match study manifest.");
const entry = createRequire(import.meta.url).resolve("node-llama-cpp");
const pkg = JSON.parse(readFileSync(resolve(dirname(entry), "../package.json")));
if ("node-llama-cpp@" + pkg.version !== meta.runtime) throw new Error("Runtime version mismatch");
const { getLlama, LlamaText, SpecialTokensText } = await import(pathToFileURL(entry).href);
const llama = await getLlama({ gpu: false, build: "never", maxThreads: meta.threads, logLevel: "error" });
const model = await llama.loadModel({ modelPath, gpuLayers: 0 });
const context = await model.createContext({ contextSize: meta.context, batchSize: meta.batch_size, threads: meta.threads, flashAttention: false });
const sequence = context.getSequence();
const stop = model.tokenize("<|im_end|>", true);
if (stop.length !== 1) throw new Error("Expected one ChatML terminator");
const requests = readFileSync(inputFile, "utf8").trim().split("\n").map(JSON.parse).filter(r => r.model === alias);
const byKey = new Map(requests.map(r => [r.episode_id + "/" + r.turn, r]));
const completed = new Set();
if (existsSync(output)) {
  for (const line of readFileSync(output, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    const key = r.episode_id + "/" + r.turn;
    const source = byKey.get(key);
    if (!source || completed.has(key) || r.model !== alias ||
      Boolean(r.greedy_path) !== (mode === "greedy") ||
      (mode !== "greedy" && r.scoring_version !== "cold-prefix-v2") ||
      source.reply !== r.reply || source.observation_changed !== r.observation_changed ||
      source.original_feedback !== r.original_feedback || source.swapped_feedback !== r.swapped_feedback) {
      throw new Error("Existing shard differs from the requested model, mode or decision set: " + key);
    }
    completed.add(key);
  }
}

function promptTokens(messages) {
  const chat = messages.map(({ role, content }) => [new SpecialTokensText(`<|im_start|>${role}\n`), content, new SpecialTokensText("<|im_end|>\n")]);
  return LlamaText(chat, new SpecialTokensText("<|im_start|>assistant\n")).tokenize(model.tokenizer);
}

const query = { generateNext: { probabilities: true, options: { temperature: 1, topK: 0, topP: 1, minP: 0, seed: 42 } } };

async function rootDistribution(prefix) {
  // Start each distinct decision as the archived generator did. Reusing KV
  // across *different* prompts can change CPU quantized batch geometry.
  await sequence.clearHistory();
  const input = prefix.slice();
  input[input.length - 1] = [input.at(-1), query];
  const result = await sequence.controlledEvaluate(input);
  return result.at(-1).next.probabilities;
}

function logProb(map, id) {
  const probability = map.get(id);
  if (!(probability > 0)) throw new Error("Missing positive token probability for " + id);
  return Math.log(probability);
}

async function conditionalScore(prefix, distribution, text, terminate) {
  const content = model.tokenize(text, false, "trimLeadingSpace");
  const ids = terminate ? [...content, ...stop] : content;
  if (!ids.length) return { token_ids: [], token_logprobs: [], logprob: 0 };
  if (mode === "branch-audit") distribution = await rootDistribution(prefix);
  const parts = [logProb(distribution, ids[0])];
  if (ids.length > 1) {
    await sequence.adaptStateToTokens(prefix, false);
    // Append one forced token at a time, matching the original decode batch
    // size. Only this decision's cold-evaluated prefix is shared by its branches.
    for (let i = 1; i < ids.length; i++) {
      const [result] = await sequence.controlledEvaluate([[ids[i - 1], query]]);
      parts.push(logProb(result.next.probabilities, ids[i]));
    }
  }
  return { token_ids: ids, token_logprobs: parts, logprob: parts.reduce((a, b) => a + b, 0) };
}

async function measure(request) {
  const prefix = promptTokens(request.messages);
  if (!("observation_changed" in request) && prefix.length !== request.input_tokens) throw new Error("Archive input token count differs");
  const first = await rootDistribution(prefix);
  const top = [];
  for (const [id, probability] of first) {
    top.push({ id, text: model.detokenize([id], true), probability });
    if (top.length === 10) break;
  }
  const candidates = {};
  for (const action of request.menu) candidates[action] = await conditionalScore(prefix, first, action, true);
  const ranked = Object.keys(candidates).sort((a, b) => candidates[b].logprob - candidates[a].logprob);
  const maximum = candidates[ranked[0]].logprob;
  const denominator = ranked.reduce((n, a) => n + Math.exp(candidates[a].logprob - maximum), 0);
  for (const a of ranked) candidates[a].menu_probability = Math.exp(candidates[a].logprob - maximum) / denominator;
  const entropy = ranked.reduce((v, a) => v - candidates[a].menu_probability * Math.log(candidates[a].menu_probability), 0);
  let logged;
  if (request.logged_action === request.reply && request.finish_reason === "stop") logged = candidates[request.logged_action];
  else logged = await conditionalScore(prefix, first, request.reply, request.finish_reason === "stop");
  return {
    scoring_version: "cold-prefix-v2", prefix_tokens: prefix.length, top_tokens: top, candidates,
    top_action: ranked[0], runner_up: ranked[1],
    menu_entropy_nats: entropy, margin_nats: maximum - candidates[ranked[1]].logprob,
    menu_logmass: maximum + Math.log(denominator), logged_continuation: logged
  };
}

// Archived replies store decoded text. Reconstruct the greedy vocabulary-token
// path independently, including EOG (unless truncated), and test both text and
// original output length before attributing its likelihood to a logged reply.
async function greedyPath(request) {
  const prefix = promptTokens(request.messages);
  if (prefix.length !== request.input_tokens) throw new Error("Input token count mismatch");
  let distribution = await rootDistribution(prefix);
  const content = [], ids = [], parts = [];
  let ended = false;
  while (content.length < 12) {
    const [id, probability] = distribution.entries().next().value;
    parts.push(Math.log(probability));
    ids.push(id);
    if (model.isEogToken(id)) { ended = true; break; }
    content.push(id);
    if (content.length < 12) {
      const [prediction] = await sequence.controlledEvaluate([[id, query]]);
      distribution = prediction.next.probabilities;
    }
  }
  const decoded = model.detokenize(content);
  return {
    decoded, matches_reply: decoded === request.reply, matches_length: content.length === request.output_tokens,
    matches_finish: (ended ? "stop" : "length") === request.finish_reason,
    token_ids: ids, token_logprobs: parts, logprob: parts.reduce((a, b) => a + b, 0)
  };
}

// Keep exact duplicates (including the unobserved commit bit at turn one) as
// distinct episode decisions while avoiding repeated evaluation of identical text.
const cache = new Map();
try {
  for (const r of requests) {
    if (completed.has(r.episode_id + "/" + r.turn)) continue;
    const { messages, menu, ...row } = r;
    const key = JSON.stringify([messages, menu, r.reply, r.finish_reason, r.logged_action]);
    let scored = cache.get(key);
    if (!scored) { scored = mode === "greedy" ? { greedy_path: await greedyPath(r) } : await measure(r); cache.set(key, scored); }
    appendFileSync(output, JSON.stringify({ ...row, ...scored }) + "\n");
  }
} finally { await llama.dispose(); }
