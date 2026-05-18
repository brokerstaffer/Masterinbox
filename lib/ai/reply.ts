// Reply Agent — generates a draft response to an inbound reply. Provider-
// agnostic with the same shape as label.ts: OpenAI / Anthropic / OpenRouter /
// vLLM all behave consistently. The draft is plain-text so the composer can
// rewrap it as HTML on send.

import type { AiProvider } from "./label";

// Hard max completion tokens per known model. Reply drafts almost never
// need more than ~2k tokens, but if the user sets a higher budget we still
// have to respect the model's API cap to avoid 400s.
const MODEL_MAX_COMPLETION: Record<string, number> = {
  "gpt-4o-mini": 16_384,
  "gpt-4o": 16_384,
  "gpt-4.1-mini": 32_768,
  "gpt-4.1": 32_768,
  "gpt-5-mini": 128_000,
  "gpt-5": 128_000,
  "claude-haiku-4-5-20251001": 64_000,
  "claude-haiku-4-5": 64_000,
  "claude-sonnet-4-6": 64_000,
  "claude-opus-4-7": 32_000,
};

function clampMaxTokens(model: string, requested: number): number {
  const cap = MODEL_MAX_COMPLETION[model];
  if (cap && requested > cap) return cap;
  return requested;
}

export interface DraftInput {
  provider: AiProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  tone: string;
  responseLength: "short" | "medium" | "long" | "variable";
  temperature: number;
  maxTokens: number;
  // Context the model needs to write a relevant reply.
  leadName: string | null;
  leadEmail: string | null;
  ourName: string | null;
  ourEmail: string | null;
  subject: string | null;
  inboundBody: string;
}

export interface DraftResult {
  body: string;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
}

export async function generateReplyDraft(input: DraftInput): Promise<DraftResult> {
  const userPrompt = renderUserPrompt(input);

  if (input.provider === "openai" || input.provider === "openrouter" || input.provider === "vllm") {
    return openaiCompatible(input, userPrompt);
  }
  return anthropic(input, userPrompt);
}

function renderUserPrompt(input: DraftInput): string {
  const truncated = (input.inboundBody ?? "").slice(0, 8000);
  const lengthHint =
    input.responseLength === "short"
      ? "Keep it under 2 sentences."
      : input.responseLength === "long"
        ? "Use 2-3 short paragraphs."
        : input.responseLength === "variable"
          ? "Match the lead's message length and tone — keep it short if they were brief, expand if they wrote a longer message."
          : "One short paragraph (3-5 sentences).";
  return [
    `You are responding to a sales-outreach reply from a lead.`,
    `Tone: ${input.tone}.`,
    lengthHint,
    "Write ONLY the reply body — no greeting line, no sign-off, no subject line, no preamble.",
    "",
    `Their name: ${input.leadName ?? "the lead"}`,
    `Your name: ${input.ourName ?? "You"}`,
    `Subject thread: ${input.subject ?? "(no subject)"}`,
    "",
    "Their last message:",
    truncated,
  ].join("\n");
}

async function openaiCompatible(input: DraftInput, userPrompt: string): Promise<DraftResult> {
  const baseUrl =
    input.provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature,
      max_tokens: clampMaxTokens(input.model, input.maxTokens),
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI provider returned ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const body = (json.choices?.[0]?.message?.content ?? "").trim();
  return {
    body,
    tokensPrompt: json.usage?.prompt_tokens ?? null,
    tokensCompletion: json.usage?.completion_tokens ?? null,
  };
}

async function anthropic(input: DraftInput, userPrompt: string): Promise<DraftResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: clampMaxTokens(input.model, input.maxTokens),
      temperature: input.temperature,
      system: input.systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic returned ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const body = (json.content?.find((b) => b.type === "text")?.text ?? "").trim();
  return {
    body,
    tokensPrompt: json.usage?.input_tokens ?? null,
    tokensCompletion: json.usage?.output_tokens ?? null,
  };
}

export const DEFAULT_REPLY_SYSTEM_PROMPT = `You are an outbound-sales rep
responding to inbound replies from leads. Your goal is to keep momentum
toward a meeting without sounding pushy.

Guidelines:
- Be direct, warm, and concise.
- Mirror the lead's tone (formal vs casual).
- If the lead is interested, propose a concrete next step (e.g. 15-min
  intro call this week, calendar link, a deck).
- If the lead asks a factual question, answer it briefly before pivoting
  to the next step.
- If the lead is hesitant or asks for later, acknowledge and offer to
  reach back out at the requested time.
- Never repeat the original pitch verbatim.
- Plain text only. No subject, no greeting, no sign-off — just the body.`;
