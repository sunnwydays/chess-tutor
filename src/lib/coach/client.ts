import Anthropic from "@anthropic-ai/sdk";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { COACH_REPLY_SCHEMA, type CoachReply, type CoachRequest, type CoachResponse } from "./schema";
import { fallbackReply, validateReply } from "./validate";
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
export async function generateCoachReply(req: CoachRequest): Promise<CoachResponse> {
  const judgement: AttemptJudgement | null =
    req.stage === "attempt" && req.attempt ? judgeAttempt(req.moment, req.attempt, req.attemptEvalCp) : null;
  const user = buildUserMessage(req, judgement);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
  const allErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: CoachReply;
    try {
      reply = await callModel(messages);
    } catch (err) {
      allErrors.push(err instanceof Error ? err.message : String(err));
      break;
    }
    const errors = validateReply(reply, req, judgement);
    if (errors.length === 0) {
      return { reply, source: "llm", attemptVerdict: judgement?.verdict ?? null, errors: allErrors.length ? allErrors : undefined };
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
    reply: fallbackReply(req, judgement),
    source: "fallback",
    attemptVerdict: judgement?.verdict ?? null,
    errors: allErrors,
  };
}
