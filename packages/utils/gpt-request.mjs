import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const GEEKGEEKRUN_AI_PROVIDER_NAME = "geekgeekrunOpenaiCompatible";

export function normalizeThinkingConfig(thinking) {
  const rawBudget = thinking?.budget;
  const budget =
    Number.isInteger(rawBudget) && rawBudget > 0
      ? rawBudget
      : 2048;

  return {
    enabled: thinking?.enabled === true,
    budget,
  };
}

export function resolveMaxOutputTokens(maxTokens, thinking) {
  if (!thinking?.enabled) {
    return typeof maxTokens === "number" ? maxTokens : 1200;
  }

  const minimum = thinking.budget + 512;
  if (typeof maxTokens === "number") {
    return Math.max(maxTokens, minimum);
  }
  return Math.max(8192, minimum);
}

export function resolveTemperature(temperature, thinking) {
  if (typeof temperature === "number") {
    return temperature;
  }
  return thinking?.enabled ? 0.6 : 0.1;
}

export function buildProviderOptions({ response_format, thinking } = {}) {
  const normalizedThinking = normalizeThinkingConfig(thinking);
  if (!response_format && !normalizedThinking.enabled) {
    return undefined;
  }

  const body = {};
  if (response_format) {
    body.response_format = response_format;
  }
  if (normalizedThinking.enabled) {
    body.enable_thinking = true;
    body.thinking_budget = normalizedThinking.budget;
  }

  return {
    [GEEKGEEKRUN_AI_PROVIDER_NAME]: body,
  };
}

function stringifyOutput(output) {
  if (output === undefined) {
    return "";
  }
  return JSON.stringify(output);
}

function resolveReasoningText(result) {
  if (Array.isArray(result.reasoning)) {
    const reasoning = result.reasoning
      .map((part) => part?.text)
      .filter((text) => typeof text === "string" && text.length > 0)
      .join("\n");
    if (reasoning) {
      return reasoning;
    }
  }
  return typeof result.reasoningText === "string" ? result.reasoningText : undefined;
}

function tokenValue(value) {
  return typeof value === "number" ? value : null;
}

function normalizeSystemContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return content == null ? "" : String(content);
}

export function normalizeMessagesForGenerateText(messages = []) {
  const systemMessages = [];
  const conversationMessages = [];

  for (const message of messages ?? []) {
    if (message?.role === "system") {
      const content = normalizeSystemContent(message.content);
      if (content) {
        systemMessages.push(content);
      }
      continue;
    }
    conversationMessages.push(message);
  }

  return {
    system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
    messages: conversationMessages,
  };
}

export function toOpenAICompatibleCompletion(result) {
  const usage = result.usage ?? result.totalUsage ?? {};
  const inputTokenDetails = usage.inputTokenDetails ?? {};
  const outputTokenDetails = usage.outputTokenDetails ?? {};
  const content =
    typeof result.text === "string" ? result.text : stringifyOutput(result.output);
  const reasoningContent = resolveReasoningText(result);

  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          reasoning_content: reasoningContent,
        },
        finish_reason: result.finishReason ?? null,
      },
    ],
    usage: {
      prompt_tokens: tokenValue(usage.inputTokens),
      completion_tokens: tokenValue(usage.outputTokens),
      total_tokens: tokenValue(usage.totalTokens),
      prompt_cache_hit_tokens: tokenValue(inputTokenDetails.cacheReadTokens),
      prompt_cache_miss_tokens: tokenValue(
        inputTokenDetails.noCacheTokens ?? inputTokenDetails.cacheWriteTokens,
      ),
      reasoning_tokens: tokenValue(outputTokenDetails.reasoningTokens),
    },
    _aiSdk: {
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
      warnings: result.warnings,
    },
  };
}

export async function completes(
  {
    baseURL,
    apiKey,
    model,
    max_tokens,
    temperature,
    thinking,
    response_format,
  },
  messages,
) {
  const provider = createOpenAICompatible({
    name: GEEKGEEKRUN_AI_PROVIDER_NAME,
    baseURL,
    apiKey,
  });
  const normalizedThinking = normalizeThinkingConfig(thinking);
  const maxOutputTokens = resolveMaxOutputTokens(max_tokens, normalizedThinking);
  const resolvedTemperature = resolveTemperature(temperature, normalizedThinking);
  const providerOptions = buildProviderOptions({
    response_format,
    thinking: normalizedThinking,
  });
  const normalizedMessages = normalizeMessagesForGenerateText(messages);

  const result = await generateText({
    model: provider(model),
    system: normalizedMessages.system,
    messages: normalizedMessages.messages,
    maxOutputTokens,
    temperature: resolvedTemperature,
    providerOptions,
  });

  const completion = toOpenAICompatibleCompletion(result);
  const msg = completion.choices[0].message;
  if (msg.reasoning_content) {
    console.log(
      "[gpt-request] reasoning_content:",
      String(msg.reasoning_content).slice(0, 200),
    );
  }
  console.log("[gpt-request] content:", String(msg.content ?? "").slice(0, 200));
  return completion;
}
