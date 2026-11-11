import type { MomentAnalysis } from "@/lib/engine/types";
import { winProb } from "@/lib/engine/types";
import type { AttemptVerdict } from "./schema";

/** Strip check/mate/annotation suffixes so "Nf3+!" and "Nf3" compare equal. */
export function normSan(san: string): string {
  return san.replace(/[+#!?]+$/g, "");
}

export interface AttemptJudgement {
  verdict: AttemptVerdict;
  /** Eval of the attempt, user POV, if known. */
  evalCp: number | null;
  /** 1-based rank in the MultiPV list, or null if not in it. */
  rank: number | null;
  /** Win-probability points lost vs the best line (0 for the best move). */
  wpLoss: number | null;
}

/**
 * The engine judges the attempt. Win-probability loss vs the best line:
 * < 2 pts = best-equivalent, < 5 = good, < 10 = inaccuracy, else mistake.
 */
export function judgeAttempt(
  moment: MomentAnalysis,
  attempt: string,
  attemptEvalCp?: number,
): AttemptJudgement {
  const best = moment.lines[0];
  if (!best) return { verdict: "unknown", evalCp: null, rank: null, wpLoss: null };
  const a = normSan(attempt);
  const idx = moment.lines.findIndex((l) => normSan(l.move) === a);
  let evalCp: number | null = null;
  let rank: number | null = null;
  if (idx >= 0) {
    evalCp = moment.lines[idx].evalCp;
    rank = idx + 1;
  } else if (attemptEvalCp !== undefined) {
    evalCp = attemptEvalCp;
  } else if (normSan(moment.played) === a) {
    evalCp = moment.evalAfter;
  }
  if (evalCp === null) return { verdict: "unknown", evalCp: null, rank: null, wpLoss: null };
  const wpLoss = Math.max(0, winProb(best.evalCp) - winProb(evalCp));
  let verdict: AttemptVerdict;
  if (rank === 1 || wpLoss < 2) verdict = "best";
  else if (wpLoss < 5) verdict = "good";
  else if (wpLoss < 10) verdict = "inaccuracy";
  else verdict = "mistake";
  return { verdict, evalCp, rank, wpLoss };
}

/** Candidate moves good enough that naming them would give the answer away. */
export function goodCandidates(moment: MomentAnalysis): string[] {
  const best = moment.lines[0];
  if (!best) return [];
  return moment.lines
    .filter((l) => winProb(best.evalCp) - winProb(l.evalCp) < 5)
    .map((l) => normSan(l.move));
}
