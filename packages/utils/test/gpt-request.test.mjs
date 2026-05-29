import test from "node:test";
import assert from "node:assert/strict";

import {
  GEEKGEEKRUN_AI_PROVIDER_NAME,
  buildProviderOptions,
  normalizeThinkingConfig,
  resolveMaxOutputTokens,
  resolveTemperature,
  toOpenAICompatibleCompletion,
} from "../gpt-request.mjs";

test("exports the provider name used for provider options", () => {
  assert.equal(GEEKGEEKRUN_AI_PROVIDER_NAME, "geekgeekrunOpenaiCompatible");
});

test("normalizes missing and null thinking to disabled defaults", () => {
  assert.deepEqual(normalizeThinkingConfig(), { enabled: false, budget: 2048 });
  assert.deepEqual(normalizeThinkingConfig(null), { enabled: false, budget: 2048 });
});

test("normalizes enabled thinking with a numeric budget", () => {
  assert.deepEqual(normalizeThinkingConfig({ enabled: true, budget: 4096 }), {
    enabled: true,
    budget: 4096,
  });
});

test("normalizes invalid thinking budgets to the default", () => {
  assert.deepEqual(normalizeThinkingConfig({ enabled: true, budget: 0.5 }), {
    enabled: true,
    budget: 2048,
  });
  assert.deepEqual(normalizeThinkingConfig({ enabled: true, budget: 1.9 }), {
    enabled: true,
    budget: 2048,
  });
  assert.deepEqual(normalizeThinkingConfig({ enabled: true, budget: -1 }), {
    enabled: true,
    budget: 2048,
  });
});

test("resolves max output tokens for thinking and non-thinking requests", () => {
  assert.equal(resolveMaxOutputTokens(3333, { enabled: false, budget: 2048 }), 3333);
  assert.equal(resolveMaxOutputTokens(500, { enabled: true, budget: 2048 }), 2560);
  assert.equal(resolveMaxOutputTokens(undefined, { enabled: true, budget: 2048 }), 8192);
  assert.equal(resolveMaxOutputTokens(undefined, { enabled: false, budget: 2048 }), 1200);
});

test("resolves temperature defaults and preserves explicit values", () => {
  assert.equal(resolveTemperature(undefined, { enabled: true, budget: 2048 }), 0.6);
  assert.equal(resolveTemperature(undefined, { enabled: false, budget: 2048 }), 0.1);
  assert.equal(resolveTemperature(0.25, { enabled: true, budget: 2048 }), 0.25);
  assert.equal(resolveTemperature(0.25, { enabled: false, budget: 2048 }), 0.25);
});

test("builds provider options with response format and thinking settings", () => {
  const responseFormat = { type: "json_object" };

  assert.deepEqual(
    buildProviderOptions({
      response_format: responseFormat,
      thinking: { enabled: true, budget: 4096 },
    }),
    {
      [GEEKGEEKRUN_AI_PROVIDER_NAME]: {
        response_format: responseFormat,
        enable_thinking: true,
        thinking_budget: 4096,
      },
    },
  );

  assert.equal(buildProviderOptions(), undefined);
});

test("maps AI SDK text results to OpenAI-compatible completions", () => {
  const completion = toOpenAICompatibleCompletion({
    text: "{\"ok\":true}",
    reasoning: [{ text: "first" }, { text: "second" }],
    usage: {
      inputTokens: 11,
      outputTokens: 13,
      totalTokens: 24,
      inputTokenDetails: {
        cacheReadTokens: 5,
        noCacheTokens: 6,
        cacheWriteTokens: 99,
      },
      outputTokenDetails: {
        reasoningTokens: 7,
      },
    },
    finishReason: "stop",
    rawFinishReason: "stop_sequence",
    warnings: [{ type: "other", message: "warn" }],
  });

  assert.equal(completion.choices[0].message.content, "{\"ok\":true}");
  assert.equal(completion.choices[0].message.reasoning_content, "first\nsecond");
  assert.equal(completion.choices[0].finish_reason, "stop");
  assert.deepEqual(completion.usage, {
    prompt_tokens: 11,
    completion_tokens: 13,
    total_tokens: 24,
    prompt_cache_hit_tokens: 5,
    prompt_cache_miss_tokens: 6,
    reasoning_tokens: 7,
  });
  assert.deepEqual(completion._aiSdk, {
    finishReason: "stop",
    rawFinishReason: "stop_sequence",
    warnings: [{ type: "other", message: "warn" }],
  });
});

test("maps AI SDK output fallback when text is absent", () => {
  const completion = toOpenAICompatibleCompletion({
    output: { ok: true },
    totalUsage: {
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
    },
  });

  assert.equal(completion.choices[0].message.content, "{\"ok\":true}");
  assert.deepEqual(completion.usage, {
    prompt_tokens: 2,
    completion_tokens: 3,
    total_tokens: 5,
    prompt_cache_hit_tokens: null,
    prompt_cache_miss_tokens: null,
    reasoning_tokens: null,
  });
});

test("maps empty content and reasoningText fallbacks", () => {
  const completion = toOpenAICompatibleCompletion({
    reasoning: [],
    reasoningText: "fallback reasoning",
  });

  assert.equal(completion.choices[0].message.content, "");
  assert.equal(completion.choices[0].message.reasoning_content, "fallback reasoning");
  assert.deepEqual(completion.usage, {
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    prompt_cache_hit_tokens: null,
    prompt_cache_miss_tokens: null,
    reasoning_tokens: null,
  });
});
