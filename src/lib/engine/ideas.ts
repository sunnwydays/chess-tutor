/**
 * Group the engine's candidate lines by idea and classify the moment.
 * Pure functions over MomentAnalysis; no LLM. Sunny's /label lineGroups are
 * the ground truth these heuristics are checked against (scripts/eval.ts).
 */
import { Chess } from "chess.js";
import { winProb, type EngineLine, type MomentAnalysis } from "./types";
import type { MomentType } from "@/lib/moments";

/** A line counts as "good" when it is within this many win-probability points of the best. */
export const GOOD_WP_MARGIN = 5;

export function goodLines(m: MomentAnalysis, margin = GOOD_WP_MARGIN): EngineLine[] {
  const best = m.lines[0];
  if (!best) return [];
  return m.lines.filter((l) => winProb(best.evalCp) - winProb(l.evalCp) < margin);
}

interface MoveInfo {
  from: string;
  to: string;
  piece: string;
  captured?: string;
}

function moveInfo(fen: string, san: string): MoveInfo | null {
  try {
    const mv = new Chess(fen).move(san);
    return { from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured };
  } catch {
    return null;
  }
}

/** The user's own moves in a line (indices 0, 2, 4...). */
function userMoves(l: EngineLine, n = 3): string[] {
  return l.pv.filter((_, i) => i % 2 === 0).slice(0, n);
}

/**
 * Two lines share an idea when: the first move of one shows up among the first
 * user moves of the other (move-order transposition), or both move the same
 * piece from the same square (the point is "this piece has to move"), or both
 * capture on the same square.
 */
export function sameIdea(fen: string, a: EngineLine, b: EngineLine): boolean {
  if (userMoves(a).includes(b.move) || userMoves(b).includes(a.move)) return true;
  const ia = moveInfo(fen, a.move);
  const ib = moveInfo(fen, b.move);
  if (!ia || !ib) return false;
  if (ia.from === ib.from) return true;
  if (ia.captured && ib.captured && ia.to === ib.to) return true;
  return false;
}

/** Line SAN -> group letter ("A", "B", ...), best line first. Same letter = same idea. */
export function groupLines(m: MomentAnalysis, lines: EngineLine[] = m.lines): Record<string, string> {
  const groups: EngineLine[][] = [];
  for (const l of lines) {
    const g = groups.find((grp) => grp.some((x) => sameIdea(m.fenBefore, x, l)));
    if (g) g.push(l);
    else groups.push([l]);
  }
  const out: Record<string, string> = {};
  groups.forEach((grp, i) => {
    for (const l of grp) out[l.move] = String.fromCharCode(65 + i);
  });
  return out;
}

/**
 * only-move: one good line. many-roads: several good lines, one idea.
 * multi-idea: several good lines with different ideas.
 */
export function momentType(m: MomentAnalysis): MomentType {
  const good = goodLines(m);
  if (good.length <= 1) return "only-move";
  const letters = new Set(Object.values(groupLines(m, good)));
  return letters.size === 1 ? "many-roads" : "multi-idea";
}

const FILES = "abcdefgh";

/** The 3x3 neighbourhood of a square (clipped to the board). */
function around(sq: string): string[] {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]);
  const out: string[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) out.push(`${FILES[nf]}${nr}`);
    }
  }
  return out;
}

/**
 * The "zone" for the focus rung: the part of the board where the idea happens.
 * A blob around the destination squares of the good lines' first moves and the
 * opponent's punishing reply, deliberately coarse so it points at an area, not
 * a move. Deterministic, so the LLM can't widen or narrow it.
 */
export function ideaZone(m: MomentAnalysis): string[] {
  const squares = new Set<string>();
  const centers: string[] = [];
  for (const l of goodLines(m)) {
    const mv = moveInfo(m.fenBefore, l.move);
    if (mv) centers.push(mv.to);
  }
  if (m.punish) {
    const after = new Chess(m.fenBefore);
    try {
      after.move(m.played);
      const mv = after.move(m.punish.move);
      centers.push(mv.to);
    } catch {}
  }
  for (const c of centers) for (const s of around(c)) squares.add(s);
  return [...squares].sort();
}

/** The from-squares of the good lines' first moves: "the piece that has to move". */
export function pieceSquares(m: MomentAnalysis): string[] {
  const out = new Set<string>();
  for (const l of goodLines(m)) {
    const mv = moveInfo(m.fenBefore, l.move);
    if (mv) out.add(mv.from);
  }
  return [...out].sort();
}

/** Piece letters (p, n, b, r, q, k) moved by the good lines' first moves. */
export function hiddenPieces(m: MomentAnalysis): Set<string> {
  const out = new Set<string>();
  for (const l of goodLines(m)) {
    const mv = moveInfo(m.fenBefore, l.move);
    if (mv) out.add(mv.piece);
  }
  return out;
}

/** The FEN with the side to move flipped (en passant cleared), so the opponent's threats can be listed. */
export function flipTurn(fen: string): string {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  return parts.join(" ");
}

/** Is from->to a legal move for the opponent if it were their turn? (A "threat" arrow must be one.) */
export function isOpponentThreat(fen: string, from: string, to: string): boolean {
  try {
    const chess = new Chess(flipTurn(fen));
    return chess.moves({ verbose: true }).some((mv) => mv.from === from && mv.to === to);
  } catch {
    return false;
  }
}

/** Everything the prompt and the board need, computed once per moment. */
export interface IdeaFeatures {
  momentType: MomentType;
  /** Line SAN -> group letter over the good lines only. */
  groups: Record<string, string>;
  goodMoves: string[];
  zone: string[];
  pieceSquares: string[];
}

export function ideaFeatures(m: MomentAnalysis): IdeaFeatures {
  const good = goodLines(m);
  return {
    momentType: momentType(m),
    groups: groupLines(m, good),
    goodMoves: good.map((l) => l.move),
    zone: ideaZone(m),
    pieceSquares: pieceSquares(m),
  };
}
