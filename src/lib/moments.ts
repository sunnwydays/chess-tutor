import type { MomentAnalysis } from "./engine/types";
import type { GameSummary } from "./types";

/**
 * One scanned position, as written by scripts/find_moments.ts.
 * "critical": a blunder/mistake on the user's move (the lesson material).
 * "control": a user move that was fine, in a stretch where the eval sat still.
 * Controls feed find-the-moment streams where "nothing here" is the answer.
 */
export type MomentKind = "critical" | "control";

export interface MomentRecord {
  /** `${gameId}-${ply}` */
  id: string;
  /** Missing in files written before controls existed; read it as "critical". */
  kind?: MomentKind;
  game: Omit<GameSummary, "pgn"> & {
    moves: string[];
    /** Win probability (0-100, user POV) after each ply; index 0 = start position. */
    winProbs?: number[];
    /** Plies of every critical moment in this game. */
    criticalPlies?: number[];
  };
  moment: MomentAnalysis;
}

export function momentKind(r: MomentRecord): MomentKind {
  return r.kind ?? "critical";
}

/** What the player says about a moment on the /label page. */
export interface MomentLabel {
  id: string;
  /** What the player would play now, cold, before seeing the engine. SAN or free text. */
  guess?: string;
  /** Did the player sense the move was bad when playing it? */
  awareness?: "knew" | "suspected" | "felt-fine" | "no-idea";
  tags: string[];
  /** Worth turning into an eval case? */
  useful?: "yes" | "maybe" | "no";
  /** Shape of the moment; picks the ladder variant (see design_decisions/SPACED_REPETITION.md). */
  momentType?: MomentType;
  /** Engine line SAN -> idea group letter ("A", "B", ...). Ground truth for ideas.ts grouping. */
  lineGroups?: Record<string, string>;
  /** The idea in a few words, motif level ("pin the knight", "open the h-file"). */
  idea?: string;
  /** What the opponent threatens, or what makes the idea work. */
  opponentMotif?: string;
  /** Squares the player should be looking at (zone hint ground truth). */
  zone?: string[];
  notes: string;
  updatedAt: string;
}

export const MOMENT_TYPES = ["only-move", "many-roads", "multi-idea"] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];

export const LABEL_TAGS = [
  "missed tactic",
  "hanging piece",
  "time pressure",
  "no plan",
  "opening unfamiliar",
  "endgame technique",
  "positional",
  "I was attacking",
  "I was defending",
  "not a fair mistake",
] as const;
