/**
 * Where review positions come from. A ReviewSource is everything MomentPanel
 * needs to run the ladder on one position: game context, engine analysis and
 * the player's rating. Sources come from the scan file (evals/moments_<user>.json)
 * and from lessons played in the app (saved to localStorage when a moment is
 * queued). Labels come from the repo's labels.json, overridden by /label edits
 * in localStorage.
 */
import { Chess } from "chess.js";
import labelsFile from "../../../labels.json";
import type { GameContext } from "@/lib/coach/schema";
import type { EngineLine, MomentAnalysis } from "@/lib/engine/types";
import type { MomentLabel, MomentRecord } from "@/lib/moments";
import { colorSwapFen, type ReviewItem } from "./queue";
import { motifTags, type RubricLabel } from "./rubric";

export interface ReviewSource {
  /** `${gameId}-${ply}`, same as the scan record and the queue item. */
  id: string;
  gameId: string;
  game: GameContext;
  moment: MomentAnalysis;
  rating: number;
  /** Coach's motif tag from the lesson; the idea tag when there is no label. */
  motif?: string;
}

const SOURCES_KEY = "chess-tutor-review-sources";
const LABELS_KEY = "chess-tutor-labels";

export function fromRecord(rec: MomentRecord): ReviewSource {
  const g = rec.game;
  return {
    id: rec.id,
    gameId: g.id,
    game: {
      white: g.white,
      black: g.black,
      userColor: g.userColor,
      result: g.result,
      timeClass: g.timeClass,
      opening: g.opening,
      moves: g.moves,
    },
    moment: rec.moment,
    rating: g[g.userColor].rating,
  };
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSources(): Record<string, ReviewSource> {
  return readJson<Record<string, ReviewSource>>(SOURCES_KEY, {});
}

export function saveSource(src: ReviewSource): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify({ ...loadSources(), [src.id]: src }));
  } catch {
    // storage full or blocked
  }
}

/** Repo labels (labels.json) with the /label page's localStorage edits on top. */
export function loadLabels(): Record<string, MomentLabel> {
  const out: Record<string, MomentLabel> = {};
  for (const l of labelsFile as MomentLabel[]) out[l.id] = l;
  const local = readJson<Record<string, MomentLabel>>(LABELS_KEY, {});
  for (const [id, l] of Object.entries(local)) if (l?.updatedAt) out[id] = { ...out[id], ...l };
  return out;
}

/** The three Form A fields, or null when the label has no idea to grade against. */
export function rubricLabel(label: MomentLabel | undefined): RubricLabel | null {
  if (!label?.idea?.trim()) return null;
  return { idea: label.idea, zone: label.zone, opponentMotif: label.opponentMotif };
}

/**
 * Motif-level idea tag used to find siblings. From the label's idea text
 * (rubric motif vocabulary, most specific motif first), else the coach's motif
 * from the lesson, else "untagged".
 */
export function ideaTag(label: MomentLabel | undefined, coachMotif?: string): string {
  for (const text of [label?.idea, label?.opponentMotif, coachMotif]) {
    if (!text) continue;
    const [first] = motifTags(text);
    if (first) return first;
  }
  const m = coachMotif?.trim().toLowerCase();
  return m ? m : "untagged";
}

/** Other moments with the same idea tag: the anti-memorization siblings, biggest swing first. */
export function siblingsOf(
  id: string,
  tag: string,
  catalog: Record<string, ReviewSource>,
  labels: Record<string, MomentLabel>,
): ReviewSource[] {
  if (tag === "untagged") return [];
  return Object.values(catalog)
    .filter((s) => s.id !== id && ideaTag(labels[s.id], s.motif) === tag)
    .sort((a, b) => drop(b.moment) - drop(a.moment));
}

function drop(m: MomentAnalysis): number {
  return m.winProbBefore - m.winProbAfter;
}

/** Fill in sibling and color-swapped positions the item does not list yet. */
export function withPositions(
  item: ReviewItem,
  catalog: Record<string, ReviewSource>,
  labels: Record<string, MomentLabel>,
): ReviewItem {
  const have = new Set(item.positions.map((p) => p.momentId ?? `${p.kind}:${p.fen}`));
  const extra: ReviewItem["positions"] = [];
  for (const s of siblingsOf(item.id, item.ideaTag, catalog, labels)) {
    if (!have.has(s.id)) extra.push({ fen: s.moment.fenBefore, kind: "sibling", sourceGame: s.gameId, momentId: s.id });
  }
  const src = catalog[item.id];
  const swapped = src ? colorSwapSource(src) : null;
  if (swapped && !item.positions.some((p) => p.kind === "perturbed")) {
    extra.push({ fen: swapped.moment.fenBefore, kind: "perturbed", sourceGame: src.gameId });
  }
  return extra.length ? { ...item, positions: [...item.positions, ...extra] } : item;
}

/** The source to play for a queue position, or null if its data is gone. */
export function resolvePosition(
  item: ReviewItem,
  pos: ReviewItem["positions"][number],
  catalog: Record<string, ReviewSource>,
): ReviewSource | null {
  if (pos.kind === "sibling") return pos.momentId ? (catalog[pos.momentId] ?? null) : null;
  const src = catalog[item.id];
  if (!src) return null;
  return pos.kind === "perturbed" ? colorSwapSource(src) : src;
}

/* ---------- color swap (the exact perturbation) ---------- */

function mirrorSquare(sq: string): string {
  return sq[0] + (9 - Number(sq[1]));
}

/** Replay `sans` from `fen` and return the same moves, mirrored, from the color-swapped position. */
export function swapLine(fen: string, sans: string[]): string[] {
  const a = new Chess(fen);
  const b = new Chess(colorSwapFen(fen));
  const out: string[] = [];
  for (const san of sans) {
    const mv = a.move(san);
    const mirrored = b.move({ from: mirrorSquare(mv.from), to: mirrorSquare(mv.to), promotion: mv.promotion });
    out.push(mirrored.san);
  }
  return out;
}

function swapEngineLine(fen: string, l: EngineLine): EngineLine {
  const pv = swapLine(fen, l.pv);
  return { ...l, move: pv[0] ?? swapLine(fen, [l.move])[0], pv };
}

/**
 * Same position with colors swapped. Evals are from the player's point of
 * view, so they carry over unchanged; every SAN is replayed and mirrored.
 * Game history no longer matches the board, so it is dropped.
 */
export function colorSwapMoment(m: MomentAnalysis): MomentAnalysis {
  const fen = m.fenBefore;
  const after = new Chess(fen);
  after.move(m.played);
  const [played] = swapLine(fen, [m.played]);
  return {
    ...m,
    ply: m.ply % 2 === 1 ? m.ply + 1 : m.ply - 1,
    fenBefore: colorSwapFen(fen),
    played,
    lines: m.lines.map((l) => swapEngineLine(fen, l)),
    punish: m.punish ? swapEngineLine(after.fen(), m.punish) : undefined,
  };
}

export function colorSwapSource(src: ReviewSource): ReviewSource | null {
  try {
    const flip = src.game.userColor === "white" ? "black" : "white";
    return {
      ...src,
      moment: colorSwapMoment(src.moment),
      game: { ...src.game, white: src.game.black, black: src.game.white, userColor: flip, moves: [] },
    };
  } catch {
    return null;
  }
}
