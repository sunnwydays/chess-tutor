import { NextResponse } from "next/server";
import { Chess } from "chess.js";
import { extractClaims } from "@/lib/review/extract";
import {
  followUpQuestion,
  grade,
  regrade,
  scoreClaims,
  type RubricGrade,
  type RubricLabel,
} from "@/lib/review/rubric";

interface GradeRequest {
  answer: string;
  fen: string;
  label: RubricLabel;
  /** Grade of the first answer when this is the follow-up; the result can rise one step at most. */
  first?: RubricGrade;
}

/**
 * Form A: Haiku extracts claims from the answer, pure code scores them against
 * the /label ground truth. The model never decides the grade.
 */
export async function POST(req: Request) {
  let body: GradeRequest;
  try {
    body = (await req.json()) as GradeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.answer !== "string" || !body.answer.trim() || body.answer.length > 600) {
    return NextResponse.json({ error: "answer must be 1-600 characters" }, { status: 400 });
  }
  try {
    new Chess(body.fen);
  } catch {
    return NextResponse.json({ error: "fen is not valid" }, { status: 400 });
  }
  if (!body.label || typeof body.label !== "object") {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  try {
    const claims = await extractClaims(body.answer, body.fen);
    const scores = scoreClaims(claims, body.label);
    const own = grade(scores);
    const final = body.first ? regrade(body.first, own) : own;
    return NextResponse.json({
      claims,
      scores,
      grade: final,
      // One follow-up only: none on the second answer.
      followUp: body.first || final === "correct" ? null : followUpQuestion(scores),
    });
  } catch (err) {
    console.error("grade route failed", err);
    return NextResponse.json({ error: "Grader is unavailable right now" }, { status: 502 });
  }
}
