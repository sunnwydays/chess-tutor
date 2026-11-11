import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { generateCoachReply } from "@/lib/coach/client";
import { STAGES, type CoachRequest } from "@/lib/coach/schema";

/** Cheap shape checks so a bad client request fails with a 400, not a stack trace. */
function checkRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  const b = body as Partial<CoachRequest>;
  if (!b.game || !Array.isArray(b.game.moves)) return "game.moves is required";
  if (!b.moment || typeof b.moment.fenBefore !== "string") return "moment.fenBefore is required";
  if (!Array.isArray(b.moment.lines) || b.moment.lines.length === 0) return "moment.lines must have at least one engine line";
  if (!b.player || typeof b.player.rating !== "number") return "player.rating is required";
  if (!b.stage || !STAGES.includes(b.stage)) return `stage must be one of ${STAGES.join(", ")}`;
  let chess: Chess;
  try {
    chess = new Chess(b.moment.fenBefore);
  } catch {
    return "moment.fenBefore is not a valid FEN";
  }
  if (b.stage === "attempt") {
    if (!b.attempt) return "attempt is required at stage attempt";
    try {
      chess.move(b.attempt);
    } catch {
      return `attempt "${b.attempt}" is not a legal move in this position`;
    }
  }
  return null;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const problem = checkRequest(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const result = await generateCoachReply(body as CoachRequest);
    return NextResponse.json(result);
  } catch (err) {
    console.error("coach route failed", err);
    return NextResponse.json({ error: "Coach is unavailable right now" }, { status: 502 });
  }
}
