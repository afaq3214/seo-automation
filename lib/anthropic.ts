import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

/**
 * One Claude call that must return JSON matching `schema` (structured outputs).
 * Throws a readable error on refusal, truncation or unparseable output.
 */
export async function claudeJson<T extends z.ZodType>(options: {
  label: string;
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
  /** Override the default model (e.g. an independent judge model) */
  model?: string;
  /** Reasoning effort, for models that support it */
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
  const model = options.model ?? env().ANTHROPIC_MODEL;
  let response;
  try {
    response = await anthropic().messages.parse({
      model,
      max_tokens: options.maxTokens ?? 4000,
      system: options.system,
      messages: [{ role: "user", content: options.user }],
      output_config: { format: zodOutputFormat(options.schema), ...(options.effort ? { effort: options.effort } : {}) },
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
