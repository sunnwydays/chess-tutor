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

/** Squares the good lines touch in the user's first two moves: the "zone" of the idea. */
export function ideaZone(m: MomentAnalysis): string[] {
  const squares = new Set<string>();
  for (const l of goodLines(m)) {
    const chess = new Chess(m.fenBefore);
    for (const [i, san] of l.pv.slice(0, 3).entries()) {
      try {
        const mv = chess.move(san);
        if (i % 2 === 0) {
          squares.add(mv.from);
          squares.add(mv.to);
        }
      } catch {
        break;
      }
    }
  }
  return [...squares];
}
