import type { TokenUsage } from "../types";

// Per-million-token list prices. Cache writes bill at 1.25x input (5 minute TTL)
// and cache reads at 0.1x input, so cached prefixes are the single biggest lever
// on cost in a tool loop that re-sends the schema every turn.
interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

const CACHE_WRITE_MULTIPLIER = 1.25; // 5 minute TTL
const CACHE_READ_MULTIPLIER = 0.1;

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? PRICES["claude-opus-4-8"];
}

export function costUsd(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  const cost =
    (usage.input_tokens * p.input +
      usage.cache_creation_input_tokens * p.input * CACHE_WRITE_MULTIPLIER +
      usage.cache_read_input_tokens * p.input * CACHE_READ_MULTIPLIER +
      usage.output_tokens * p.output) /
    1_000_000;
  return Number(cost.toFixed(6));
}

// Fraction of input tokens that were served from cache rather than billed at
// full rate. This is the number worth watching when caching is supposed to be on.
export function cacheHitRate(usage: TokenUsage): number {
  const readable = usage.cache_read_input_tokens;
  const billedInput = usage.input_tokens + usage.cache_read_input_tokens;
  if (billedInput <= 0) return 0;
  return Number((readable / billedInput).toFixed(4));
}

export function emptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    input_tokens: a.input_tokens + (b.input_tokens ?? 0),
    output_tokens: a.output_tokens + (b.output_tokens ?? 0),
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      a.cache_read_input_tokens + (b.cache_read_input_tokens ?? 0),
  };
}
