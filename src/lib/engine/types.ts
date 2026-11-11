/**
 * Engine output as the coach consumes it. All evals are centipawns from the
 * user's point of view (positive = good for the user), so the coach never has
 * to flip signs. Mate scores are mapped to +/- 10000.
 */

export interface EngineLine {
  /** First move of the line, SAN from `fenBefore`. */
  move: string;
  /** Eval of the position after following this line, user's POV, in centipawns. */
  evalCp: number;
  /** Moves-to-mate if the line ends in forced mate (positive = user mates), else null. */
  mate: number | null;
  /** The principal variation in SAN, starting with `move`. */
  pv: string[];
}

export interface MomentAnalysis {
  /** 1-based ply of the user's move in the game (1 = White's first move). */
  ply: number;
  /** Position before the user's move. */
  fenBefore: string;
  /** The move the user played, SAN. */
  played: string;
  /** Eval before the move, user's POV. */
  evalBefore: number;
  /** Eval after the move, user's POV. */
  evalAfter: number;
  /** Win probability (0-100, user's POV) before/after. Lichess formula. */
  winProbBefore: number;
  winProbAfter: number;
  /** MultiPV lines at `fenBefore`, best first. */
  lines: EngineLine[];
  /** Best reply line for the opponent after `played` (what punishes the move), if analysed. */
  punish?: EngineLine;
}

/** Lichess win-probability curve: centipawns (user POV) -> 0..100. */
export function winProb(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
