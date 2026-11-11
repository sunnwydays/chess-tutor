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
  notes: string;
  updatedAt: string;
}

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
