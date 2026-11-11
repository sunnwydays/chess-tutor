import type { MomentAnalysis } from "./engine/types";
import type { GameSummary } from "./types";

/** One critical moment from a scanned game, as written by scripts/find_moments.ts. */
export interface MomentRecord {
  /** `${gameId}-${ply}` */
  id: string;
  game: Omit<GameSummary, "pgn"> & { moves: string[] };
  moment: MomentAnalysis;
}

/** What the player says about a moment on the /label page. */
export interface MomentLabel {
  id: string;
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
  "engine is wrong / unfair",
] as const;
