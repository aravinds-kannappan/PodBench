// Provider-agnostic chat layer for the agent loop.
//
// PodBench was built on the Anthropic Messages API. This adds an OpenRouter
// (OpenAI-compatible) path so the same loop runs through either provider without
// the loop itself knowing which. OpenRouter is used when OPENROUTER_API_KEY is
// set; otherwise the native Anthropic SDK is used. Both preserve the prompt-cache
// breakpoint on the system prefix and report token usage in the same shape, so
// the dashboard's caching and cost views work unchanged. OpenRouter additionally
// returns the real upstream dollar cost per call, which the runner prefers over
// the pricing-table estimate.
import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "../types";

export type Provider = "openrouter" | "anthropic";

export function activeProvider(): Provider {
  return process.env.OPENROUTER_API_KEY ? "openrouter" : "anthropic";
}

export function hasCredentials(): boolean {
  return !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export function credentialHint(): string {
  return "Set OPENROUTER_API_KEY (recommended) or ANTHROPIC_API_KEY to execute live runs.";
}

// Canonical podbench model id -> OpenRouter slug. Run records keep the canonical
// id so the dashboard groups runs the same way regardless of provider.
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "claude-opus-4-8": "anthropic/claude-opus-4.8",
  "claude-opus-4-7": "anthropic/claude-opus-4.7",
  "claude-opus-4-6": "anthropic/claude-opus-4.6",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
};

export function resolveModelId(model: string, provider: Provider): string {
  if (provider === "anthropic") return model;
  if (model.includes("/")) return model; // already an OpenRouter slug
  return (
    OPENROUTER_MODEL_MAP[model] ??
    `anthropic/${model.replace(/-(\d+)-(\d+)$/, ".$1.$2")}`
  );
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelTurn {
  assistantMessage: unknown; // provider-native; pushed back into history as-is
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  costUsd: number | null; // provider-reported actual cost, when available
}

export interface CallParams {
  provider: Provider;
  apiModel: string; // resolved provider model id
  system: string;
  tools: ToolDef[];
  messages: any[]; // provider-native running history (no system message)
  effort?: string;
  maxTokens?: number;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isRetryable(err: any): boolean {
  const status = err?.status ?? err?.response?.status ?? 0;
  return status === 429 || (typeof status === "number" && status >= 500);
}

// ----- message construction (provider-native) ------------------------------

export function userMessage(text: string): any {
  return { role: "user", content: text };
}

// Tool results to append after an assistant tool-call turn. Anthropic bundles
// them into one user message (optionally with an extra text block for a mid-task
// redirect); OpenAI/OpenRouter wants one `tool` message per call plus an optional
// `user` message for the redirect. Returns the list of messages to push.
export function toolResultMessages(
  provider: Provider,
  results: { id: string; content: string; isError?: boolean }[],
  extraText?: string
): any[] {
  if (provider === "anthropic") {
    const content: any[] = results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: r.content,
      is_error: r.isError,
    }));
    if (extraText) content.push({ type: "text", text: extraText });
    return [{ role: "user", content }];
  }
  const msgs: any[] = results.map((r) => ({
    role: "tool",
    tool_call_id: r.id,
    content: r.content,
  }));
  if (extraText) msgs.push({ role: "user", content: extraText });
  return msgs;
}

// ----- the call ------------------------------------------------------------

export async function callModel(p: CallParams): Promise<ModelTurn> {
  return p.provider === "anthropic" ? callAnthropic(p) : callOpenRouter(p);
}

async function callAnthropic(p: CallParams): Promise<ModelTurn> {
  const client = new Anthropic();
  const system = [
    { type: "text", text: p.system, cache_control: { type: "ephemeral" } },
  ];
  const tools = p.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  let message: any;
  try {
    message = await (client.messages.create as any)({
      model: p.apiModel,
      max_tokens: p.maxTokens ?? 1500,
      system,
      tools,
      output_config: p.effort ? { effort: p.effort } : undefined,
      messages: p.messages,
    });
  } catch (err: any) {
    throw new HttpError(err?.status ?? err?.response?.status ?? 0, err?.message ?? String(err));
  }
  const blocks = (message.content as any[]) || [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
  const u = message.usage ?? {};
  return {
    assistantMessage: { role: "assistant", content: message.content },
    text,
    toolCalls,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
    costUsd: null,
  };
}

async function callOpenRouter(p: CallParams): Promise<ModelTurn> {
  const tools = p.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  // The system carries an Anthropic cache_control breakpoint so the long playbook
  // prefix is cached on the provider side, mirroring the native path.
  const systemMsg = {
    role: "system",
    content: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
  };
  const body: Record<string, unknown> = {
    model: p.apiModel,
    max_tokens: p.maxTokens ?? 1500,
    messages: [systemMsg, ...p.messages],
    tools,
    usage: { include: true }, // ask OpenRouter to return token + cost accounting
  };

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/aravinds-kannappan/PodBench",
        "X-Title": "podbench",
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    throw new HttpError(0, err?.message ?? "network error");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new HttpError(res.status, `openrouter ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  if (data.error) {
    throw new HttpError(Number(data.error.code) || 500, data.error.message ?? "openrouter error");
  }
  const msg = data.choices?.[0]?.message ?? { role: "assistant", content: "" };
  const text =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text ?? "").join("")
        : "";
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name,
    input: safeParse(tc.function?.arguments),
  }));
  const u = data.usage ?? {};
  const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = u.prompt_tokens_details?.cache_write_tokens ?? 0;
  const promptTokens = u.prompt_tokens ?? 0;
  return {
    assistantMessage: msg,
    text,
    toolCalls,
    usage: {
      input_tokens: Math.max(0, promptTokens - cacheRead - cacheWrite),
      output_tokens: u.completion_tokens ?? 0,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
    costUsd: typeof u.cost === "number" ? u.cost : null,
  };
}

function safeParse(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
