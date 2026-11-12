import Anthropic from "@anthropic-ai/sdk";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { COACH_REPLY_SCHEMA, type CoachNotice, type CoachReply, type CoachRequest, type CoachResponse } from "./schema";
import { decorateReply, fallbackReply, validateReply } from "./validate";
import { ideaFeatures } from "@/lib/engine/ideas";
import { judgeAttempt, type AttemptJudgement } from "./verdict";

export const COACH_MODEL = "claude-sonnet-5-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

async function callModel(messages: Anthropic.Beta.BetaMessageParam[]): Promise<CoachReply> {
  const res = await client().beta.messages.create({
    model: COACH_MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: COACH_REPLY_SCHEMA } },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages,
  });
  if (res.stop_reason === "refusal") {
    throw new Error(`model refused (${res.stop_details?.category ?? "unknown"})`);
  }
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`no text block (stop_reason ${res.stop_reason})`);
  return JSON.parse(text) as CoachReply;
}

/**
 * One coach reply: build the prompt, call the model, validate against the
 * position and the engine, regenerate once with the errors fed back, and fall
 * back to an engine-only reply if that fails too.
 */
/**
 * Map an API failure to a notice for the player. Budget: out of credit or past
 * the workspace spend limit (Anthropic returns 400/402/403 with a billing message).
 */
export function classifyApiError(err: unknown): CoachNotice | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  if (err.status === 429) return "rate-limited";
  if (/credit|billing|spend|budget|quota/i.test(err.message)) return "budget";
  if (err.status === 401 || err.status === 403 || err.status === undefined || err.status >= 500) return "unavailable";
  return null;
}

function judgeAndFeatures(req: CoachRequest) {
  const judgement: AttemptJudgement | null =
    req.stage === "attempt" && req.attempt ? judgeAttempt(req.moment, req.attempt, req.attemptEvalCp) : null;
  return { judgement, features: ideaFeatures(req.moment) };
}

/** Engine-only reply without calling the model (rate limit hit, no key, or out of budget). */
export function engineOnlyResponse(req: CoachRequest, notice: CoachNotice): CoachResponse {
  const { judgement, features } = judgeAndFeatures(req);
  return {
    reply: decorateReply(fallbackReply(req, judgement, features), req, features),
    source: "fallback",
    notice,
    attemptVerdict: judgement?.verdict ?? null,
  };
}

export async function generateCoachReply(req: CoachRequest): Promise<CoachResponse> {
  if (!process.env.ANTHROPIC_API_KEY) return engineOnlyResponse(req, "unavailable");
  const { judgement, features } = judgeAndFeatures(req);
  const user = buildUserMessage(req, judgement, features);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
  const allErrors: string[] = [];
  let notice: CoachNotice | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: CoachReply;
    try {
      reply = await callModel(messages);
    } catch (err) {
      allErrors.push(err instanceof Error ? err.message : String(err));
      notice = classifyApiError(err) ?? undefined;
      break;
    }
    const errors = validateReply(reply, req, judgement, features);
    if (errors.length === 0) {
      return { reply: decorateReply(reply, req, features), source: "llm", attemptVerdict: judgement?.verdict ?? null, errors: allErrors.length ? allErrors : undefined };
    }
    allErrors.push(...errors.map((e) => `try ${attempt + 1}: ${e}`));
    messages.push(
      { role: "assistant", content: JSON.stringify(reply) },
      {
        role: "user",
        content: `That reply failed these checks:\n- ${errors.join("\n- ")}\nReturn a corrected reply for the same <stage>. Same rules apply.`,
      },
    );
  }

  return {
    reply: fallbackReply(req, judgement, features),
    source: "fallback",
    ...(notice ? { notice } : {}),
    attemptVerdict: judgement?.verdict ?? null,
    errors: allErrors,
  };
}
