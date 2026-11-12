/**
 * Review session rules (pure): which assistance level a rep starts at, which
 * ladder rungs that level allows, and how a finished rep turns into a queue
 * verdict. See design_decisions/SPACED_REPETITION.md.
 */
import type { Stage } from "@/lib/coach/schema";
import type { ReviewItem, ReviewRep } from "./queue";
import type { RubricGrade } from "./rubric";
import type { StreamGrade } from "./streams";

export type Level = ReviewRep["startLevel"];

/**
 * Box -> starting level. Box 0: 5 on the first review (game context), 4 after
 * a miss. Box 1: Form A (idea question) when the moment has a labelled idea,
 * else attempt only. Box 2: Form B (find the moment) when a scan record can
 * build the stream, else attempt only.
 */
export function levelFor(item: ReviewItem, has: { ideaLabel: boolean; stream: boolean }): Level {
  if (item.box === 0) return item.history.length === 0 ? 5 : 4;
  if (item.box === 1) return has.ideaLabel ? 1 : 2;
  return has.stream ? 0 : 2;
}

/** Rungs a level offers before the player gives up ("Show the answer" is always there after an attempt). */
export function rungsFor(level: Level): Stage[] {
  if (level >= 4) return ["focus", "threat", "piece", "move", "explain"];
  if (level === 3) return ["focus", "threat", "piece"];
  return [];
}

/** Ladder level after a review form: Form A by grade (2/3/4), Form B correct -> 2, else 4. */
export function ladderAfterFind(g: StreamGrade): Level {
  return g === "correct" ? 2 : 4;
}

export interface LadderOutcome {
  /** Found a good or best move. */
  solved: boolean;
  /** Rungs taken (focus..explain); a give-up counts as the move rung. */
  hintsTaken: number;
  /** Wrong moves played before the end (not counting the solving move). */
  wrongAttempts?: number;
  msToFirstAttempt: number;
}

/** Found on the first try with no hints: the only outcome that counts as "no help". */
export function solvedCold(o: LadderOutcome | null | undefined): boolean {
  return !!o?.solved && o.hintsTaken === 0 && !o.wrongAttempts;
}

export interface RepInput {
  startLevel: Level;
  positionKind: ReviewRep["positionKind"];
  ladder: LadderOutcome | null;
  ideaGrade?: RubricGrade;
  findGrade?: StreamGrade;
}

/** Memorization: a correct answer on the original at level 2 or lower in under 5 s. */
export const MEMORIZED_MS = 5000;

/**
 * Finished rep -> queue rep. Form A correct = right-idea; Form B correct =
 * noticed, else missed. Otherwise the ladder decides: right-move only when
 * found on the first try with no hints.
 */
export function toRep(r: RepInput): Omit<ReviewRep, "at"> {
  const hintsTaken = r.ladder?.hintsTaken ?? 0;
  const ms = r.ladder?.msToFirstAttempt ?? 0;
  let verdict: ReviewRep["verdict"];
  if (r.findGrade !== undefined) verdict = r.findGrade === "correct" ? "noticed" : "missed";
  else if (r.ideaGrade === "correct") verdict = "right-idea";
  else verdict = solvedCold(r.ladder) ? "right-move" : "wrong";
  const success = verdict !== "wrong" && verdict !== "missed";
  return {
    positionKind: r.positionKind,
    startLevel: r.startLevel,
    hintsTaken,
    grade: r.startLevel + hintsTaken,
    verdict,
    msToFirstAttempt: ms,
    memorizedFlag:
      success && r.positionKind === "original" && r.startLevel <= 2 && ms > 0 && ms < MEMORIZED_MS,
  };
}
