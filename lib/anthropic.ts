import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

interface JsonCall<T extends z.ZodType> {
  label: string;
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
  /** Override the default model (e.g. the judge model). "claude-…" ids go to Anthropic, anything else to Kimi. */
  model?: string;
  /** Reasoning effort, for models that support it */
  effort?: "low" | "medium" | "high";
}

/** The model used when a call doesn't name one: the configured provider's default. */
export function defaultModel(): string {
  const e = env();
  return e.AI_PROVIDER === "kimi" ? e.KIMI_MODEL : e.ANTHROPIC_MODEL;
}

/**
 * One AI call that must return JSON matching `schema`. The provider follows the model: Claude models
 * use Anthropic's structured outputs; other models go to Kimi (Moonshot, OpenAI-compatible API).
 * Throws a readable error on refusal, truncation or unparseable output.
 */
export async function claudeJson<T extends z.ZodType>(options: JsonCall<T>): Promise<z.infer<T>> {
  const model = options.model ?? defaultModel();
  return model.startsWith("claude") ? anthropicJson(options, model) : kimiJson(options, model);
}

async function anthropicJson<T extends z.ZodType>(options: JsonCall<T>, model: string): Promise<z.infer<T>> {
  let response;
  try {
    response = await anthropic().messages.parse({
      model,
      max_tokens: options.maxTokens ?? 4000,
      system: options.system,
      messages: [{ role: "user", content: options.user }],
      output_config: { format: zodOutputFormat(options.schema), ...(options.effort && !/haiku/i.test(model) ? { effort: options.effort } : {}) },
    });
  } catch (err) {
    throw friendlyError(err);
  }

  if (response.stop_reason === "refusal") throw new Error(`Claude declined the ${options.label} request`);
  if (response.stop_reason === "max_tokens") throw new Error(`Claude's ${options.label} response was cut off`);
  if (response.parsed_output == null) throw new Error(`Claude's ${options.label} response was not valid JSON`);

  logger.info("claude call complete", {
    label: options.label,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  return response.parsed_output as z.infer<T>;
}

/** With thinking enabled, Kimi's reasoning counts against max_tokens, so leave room for it. */
const KIMI_REASONING_HEADROOM = 8000;
const KIMI_TIMEOUT_MS = 240_000;
const KIMI_TOKEN_SCALE = 1.2;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Kimi has no guaranteed-schema mode we can rely on for large schemas, so: JSON mode + the JSON Schema
 * in the system prompt, then validate with zod. One retry, telling the model what was wrong.
 */
async function kimiJson<T extends z.ZodType>(options: JsonCall<T>, model: string): Promise<z.infer<T>> {
  const e = env();
  if (!e.KIMI_API_KEY) throw new Error("KIMI_API_KEY is not set (AI_PROVIDER is kimi)");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        options.system,
        "",
        "Reply with ONE JSON object and nothing else: no markdown, no code fences, no commentary.",
        "It must match this JSON Schema exactly (same property names, all required properties present):",
        JSON.stringify(z.toJSONSchema(options.schema)),
      ].join("\n"),
    },
    { role: "user", content: options.user },
  ];

  let problem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { content, finish, usage } = await kimiChat(e.KIMI_BASE_URL, e.KIMI_API_KEY, {
      model,
      // A little headroom over the caller's budget; kept tight so a runaway reply is cut off (and retried) quickly.
      max_tokens: Math.round((options.maxTokens ?? 4000) * KIMI_TOKEN_SCALE) + (e.KIMI_THINKING === "enabled" ? KIMI_REASONING_HEADROOM : 0),
      response_format: { type: "json_object" },
      thinking: { type: e.KIMI_THINKING },
      // Lower randomness: at the default, the model sometimes runs far past the requested length.
      temperature: 0.6,
      messages,
    });
    logger.info("kimi call complete", { label: options.label, model, attempt, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens });
    if (finish === "length") throw new Error(`Kimi's ${options.label} response was cut off`);
    if (finish === "content_filter") throw new Error(`Kimi declined the ${options.label} request`);

    let json: unknown;
    try {
      json = JSON.parse(extractJson(content));
    } catch {
      problem = "The reply was not valid JSON.";
      json = undefined;
    }
    if (json !== undefined) {
      const parsed = options.schema.safeParse(json);
      if (parsed.success) return parsed.data;
      problem = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    }
    logger.warn("kimi reply did not match the schema", { label: options.label, attempt, problem: problem.slice(0, 300) });
    messages.push({ role: "assistant", content: content.slice(0, 20_000) }, { role: "user", content: `That reply was rejected: ${problem} Send the complete corrected JSON object again.` });
  }
  throw new Error(`Kimi's ${options.label} response did not match the expected format (${problem.slice(0, 200)})`);
}

async function kimiChat(baseUrl: string, apiKey: string, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(KIMI_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Kimi did not respond (${err instanceof Error ? err.message : String(err)}). Try again in a few minutes.`);
  }
  const json = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; type?: string };
  } | null;
  if (!res.ok) {
    const text = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error("Kimi rejected the API key (KIMI_API_KEY).");
    if (res.status === 429 && /balance|quota|insufficient|suspend/i.test(text)) {
      throw new Error("Your Kimi (Moonshot) account is out of credit. Add credit on the Moonshot platform, then try again.");
    }
    if (res.status === 429) throw new Error("Kimi rate limit reached: wait a minute and try again.");
    if (res.status === 404) throw new Error(`Kimi model not found: check KIMI_MODEL / QUALITY_JUDGE_MODEL. (${text})`);
    if (res.status >= 500) throw new Error("Kimi is temporarily overloaded or unavailable: try again in a few minutes.");
    throw new Error(`Kimi request failed: ${text}`);
  }
  const choice = json?.choices?.[0];
  return { content: choice?.message?.content ?? "", finish: choice?.finish_reason ?? "", usage: json?.usage };
}

/** The JSON object inside a reply, tolerating code fences or stray text around it. */
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** Turn Anthropic account/API problems into messages a user can act on. */
function friendlyError(err: unknown): Error {
  if (err instanceof Anthropic.APIError) {
    const text = err.message ?? "";
    if (/credit balance/i.test(text)) {
      return new Error("Your Anthropic account is out of credits. Add credits at console.anthropic.com → Plans & Billing, then try again.");
    }
    if (err instanceof Anthropic.AuthenticationError) return new Error("Anthropic rejected the API key (ANTHROPIC_API_KEY).");
    if (err instanceof Anthropic.RateLimitError) return new Error("Anthropic rate limit reached — wait a minute and try again.");
    if (err instanceof Anthropic.NotFoundError) return new Error(`Claude model not found: check ANTHROPIC_MODEL / QUALITY_JUDGE_MODEL. (${text})`);
    if (err.status === 529 || err instanceof Anthropic.InternalServerError) {
      return new Error("Claude is temporarily overloaded or unavailable — try again in a few minutes.");
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
