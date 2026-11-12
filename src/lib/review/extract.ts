/**
 * Form A step 1 (server and scripts only): Haiku turns a free-text answer into claims.
 * Grading stays in rubric.ts (pure code).
 */
import Anthropic from "@anthropic-ai/sdk";
import { CLAIMS_SCHEMA, EXTRACT_SYSTEM_PROMPT, RUBRIC_MODEL, validateClaims, type Claims } from "./rubric";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/** Haiku extracts; chess.js validates. Throws on API failure (caller decides the fallback). */
export async function extractClaims(answer: string, fen: string): Promise<Claims> {
  const side = fen.split(" ")[1] === "b" ? "Black" : "White";
  const res = await client().messages.create({
    model: RUBRIC_MODEL,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: CLAIMS_SCHEMA } },
    system: [{ type: "text", text: EXTRACT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Position (FEN): ${fen}\n${side} to move.\n\nStudent's answer:\n"""\n${answer.trim()}\n"""`,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("extraction refused");
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`no text block (stop_reason ${res.stop_reason})`);
  return validateClaims(JSON.parse(text) as Claims, fen);
}

