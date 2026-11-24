// Optional CPU study runtime. Install node-llama-cpp@3.16.2 locally (or
// in a separate npm prefix on NODE_PATH). Download the file in --metadata.
// node scripts/local-completion.mjs /path/to/model.gguf
// stdin: one {messages:[{role,content}], max_tokens:128} per line.
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const checkpoints = new Map([
  ["qwen2.5-0.5b", {
    model: "Qwen/Qwen2.5-0.5B-Instruct-GGUF", revision: "9217f5db79a29953eb74d5343926648285ec7e67",
    filename: "qwen2.5-0.5b-instruct-q4_k_m.gguf", sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
  }],
  ["smollm2-360m", {
    model: "bartowski/SmolLM2-360M-Instruct-GGUF", revision: "7be6f65f1db715fe5dc5a4634c0d459b4eed42ec",
    filename: "SmolLM2-360M-Instruct-Q4_K_M.gguf", sha256: "2fa3f013dcdd7b99f9b237717fa0b12d75bbb89984cc1274be1471a465bac9c2",
    tokenizer_revision: "HuggingFaceTB/SmolLM2-360M-Instruct@a10cc1512eabd3dde888204e902eca88bddb4951",
  }],
]);
const { values, positionals } = parseArgs({
  options: { model: { type: "string", default: "qwen2.5-0.5b" }, metadata: { type: "boolean" } },
  allowPositionals: true,
});
const checkpoint = checkpoints.get(values.model);
if (!checkpoint) throw new Error("Unknown checkpoint alias. Available models: " + [...checkpoints.keys()].join(", "));
const threads = Number(process.env.PODBENCH_CPU_THREADS ?? 2);
if (!Number.isSafeInteger(threads) || threads < 1) throw new Error("Invalid PODBENCH_CPU_THREADS");
const metadata = {
  ...checkpoint,
  url: `https://huggingface.co/${checkpoint.model}/resolve/${checkpoint.revision}/${checkpoint.filename}`,
  runtime: "node-llama-cpp@3.16.2", llama_cpp_build: "b8121", chat_format: "ChatML",
  threads, context: 4096, batch_size: 256, seed: 42, temperature: 0, device: "cpu",
};
if (values.metadata) {
  console.log(JSON.stringify(metadata));
  process.exit(0);
}
const [modelPath] = positionals;
if (!modelPath) throw new Error("Supply the GGUF path or use --metadata for the pinned download URL.");
const hash = createHash("sha256");
for await (const bytes of createReadStream(modelPath)) hash.update(bytes);
if (hash.digest("hex") !== metadata.sha256) throw new Error("The GGUF differs from the published SHA-256.");

const entry = createRequire(import.meta.url).resolve("node-llama-cpp");
const pkg = JSON.parse(readFileSync(resolve(dirname(entry), "../package.json"), "utf8"));
if (pkg.version !== "3.16.2") throw new Error("Install node-llama-cpp@3.16.2 to reproduce the CPU runs.");
const { getLlama, LlamaText, SpecialTokensText } = await import(pathToFileURL(entry).href);
const llama = await getLlama({ gpu: false, build: "never", maxThreads: threads, logLevel: "error" });
const model = await llama.loadModel({ modelPath, gpuLayers: 0 });
const context = await model.createContext({
  contextSize: metadata.context, batchSize: metadata.batch_size, threads, flashAttention: false,
});
const sequence = context.getSequence();

async function complete({ messages, max_tokens: limit = 128 }) {
  if (!Array.isArray(messages) || !messages.length ||
      !messages.every((m) => m && ["user", "assistant", "system"].includes(m.role) && typeof m.content === "string")) {
    throw new Error("Expected a nonempty list of role/content messages.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Expected a positive integer max_tokens.");
  // SmolLM2's upstream template supplies a default system turn only when omitted.
  if (values.model === "smollm2-360m" && messages[0].role !== "system") {
    messages = [{ role: "system", content: "You are a helpful AI assistant named SmolLM, trained by Hugging Face" }, ...messages];
  }
  const chat = messages.map(({ role, content }) => [
    new SpecialTokensText(`<|im_start|>${role}\n`), content, new SpecialTokensText("<|im_end|>\n"),
  ]);
  const tokens = LlamaText(chat, new SpecialTokensText("<|im_start|>assistant\n")).tokenize(model.tokenizer);
  if (tokens.length + limit > context.contextSize) throw new Error("Prompt and token budget exceed the context window.");
  await sequence.clearHistory();
  const output = [];
  for await (const token of sequence.evaluate(tokens, { temperature: 0, seed: metadata.seed })) {
    output.push(token);
    if (output.length >= limit) break;
  }
  return {
    text: model.detokenize(output), input_tokens: tokens.length, output_tokens: output.length,
    finish_reason: output.length === limit ? "length" : "stop",
  };
}

try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      console.log(JSON.stringify(await complete(JSON.parse(line))));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
    }
  }
} finally {
  await llama.dispose();
}
