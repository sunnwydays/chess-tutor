/**
 * Find-the-moment (assistance level 0): the player watches 6-12 plies with
 * no eval bar and says which of their moves was the inaccuracy, or "none".
 * Pure functions over scan records (evals/moments_<user>.json); seeded so a
 * record always yields the same stream for the same seed. Grading rules are
 * Form B in design_decisions/SPACED_REPETITION.md.
 */
import { Chess } from "chess.js";
import { momentKind, type MomentKind, type MomentRecord } from "@/lib/moments";

export interface StreamPly {
  /** 1-based ply in the game. */
  ply: number;
  san: string;
  /** Only the player's own moves can be picked. */
  selectable: boolean;
}

export interface Stream {
  id: string;
  recordId: string;
  gameId: string;
  kind: MomentKind;
  userColor: "white" | "black";
  /** Position before the first shown ply. */
  startFen: string;
  plies: StreamPly[];
  /** The inaccuracy's ply, or null on a control stream ("none" is right). */
  answerPly: number | null;
  /** Win-probability drop of the moment, 0 on a control. The difficulty knob. */
  swing: number;
}

export interface StreamOptions {
  minLen: number;
  maxLen: number;
  /** The window ends 0..maxAfter plies after the moment. */
  maxAfter: number;
  /** Max win-% change per ply in the 2 plies before the window for a "quiet start". */
  quietSwing: number;
  /** A moment below this drop is an inaccuracy: "none" earns missing-details, not incorrect. */
  inaccuracySwing: number;
  /** A control window may not contain a user move losing this much. */
  controlMaxDrop: number;
}

export const DEFAULT_STREAM_OPTIONS: StreamOptions = {
  minLen: 6,
  maxLen: 12,
  maxAfter: 4,
  quietSwing: 5,
  inaccuracySwing: 20,
  controlMaxDrop: 10,
};

export type StreamGrade = "correct" | "missing-details" | "incorrect";
export type StreamPick = number | "none";

/** Small seeded PRNG (mulberry32) so streams are reproducible. */
export function seededRandom(seed: number | string): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isUserPly(ply: number, userColor: "white" | "black"): boolean {
  return (ply % 2 === 1) === (userColor === "white");
}

/** Win-% lost by the side that played `ply`, from the user's POV series (0 if unknown). */
function userDrop(winProbs: number[] | undefined, ply: number): number {
  if (!winProbs || winProbs[ply] === undefined) return 0;
  return winProbs[ply - 1] - winProbs[ply];
}

function plySwing(winProbs: number[] | undefined, ply: number): number {
  if (!winProbs || winProbs[ply] === undefined) return 0;
  return Math.abs(winProbs[ply] - winProbs[ply - 1]);
}

interface Window {
  start: number;
  end: number;
}

/** Why a candidate window is unusable; null means it is fine. */
function windowProblem(
  rec: MomentRecord,
  w: Window,
  opts: StreamOptions,
  strict: boolean,
): string | null {
  const { winProbs, criticalPlies = [], userColor } = rec.game;
  const kind = momentKind(rec);
  const target = rec.moment.ply;
  if (w.start < 1) return "before game start";
  // No second critical moment in the window: the answer must be unambiguous.
  const others = criticalPlies.filter((c) => kind === "control" || c !== target);
  if (others.some((c) => c >= w.start && c <= w.end)) return "contains another critical moment";
  if (kind === "control") {
    for (let p = w.start; p <= w.end; p++) {
      if (isUserPly(p, userColor) && userDrop(winProbs, p) >= opts.controlMaxDrop) return "user error inside control window";
    }
  }
  if (strict) {
    // Quiet start: nothing happened in the 2 plies before the window.
    for (let k = 1; k <= 2; k++) {
      const p = w.start - k;
      if (p >= 1 && plySwing(winProbs, p) > opts.quietSwing) return "loud start";
    }
  }
  return null;
}

/**
 * Build one stream around a record. The window length and how far it runs
 * past the moment are drawn from the seed, so the moment can sit first,
 * last, or anywhere between. Falls back to a non-quiet start if the game
 * has no quiet stretch there.
 */
export function buildStream(
  rec: MomentRecord,
  seed: number | string,
  options: Partial<StreamOptions> = {},
): Stream {
  const opts = { ...DEFAULT_STREAM_OPTIONS, ...options };
  const rnd = seededRandom(`${rec.id}|${seed}`);
  const n = rec.game.moves.length;
  const target = rec.moment.ply;

  const candidates: Window[] = [];
  for (let after = 0; after <= opts.maxAfter; after++) {
    for (let len = opts.minLen; len <= opts.maxLen; len++) {
      const end = Math.min(target + after, n);
      candidates.push({ start: end - len + 1, end });
    }
  }
  const order = shuffle(candidates, rnd);
  let chosen = order.find((w) => windowProblem(rec, w, opts, true) === null);
  if (!chosen) chosen = order.find((w) => windowProblem(rec, w, opts, false) === null);
  if (!chosen) chosen = { start: Math.max(1, target - opts.minLen + 1), end: Math.min(n, target) };

  const chess = new Chess();
  for (let i = 0; i < chosen.start - 1; i++) chess.move(rec.game.moves[i]);
  const startFen = chess.fen();
  const plies: StreamPly[] = [];
  for (let p = chosen.start; p <= chosen.end; p++) {
    plies.push({ ply: p, san: rec.game.moves[p - 1], selectable: isUserPly(p, rec.game.userColor) });
  }
  const kind = momentKind(rec);
  return {
    id: `${rec.id}|${seed}`,
    recordId: rec.id,
    gameId: rec.game.id,
    kind,
    userColor: rec.game.userColor,
    startFen,
    plies,
    answerPly: kind === "critical" ? target : null,
    swing: kind === "critical" ? rec.moment.winProbBefore - rec.moment.winProbAfter : 0,
  };
}

/**
 * Form B grading. Exact ply = correct. Off by one move of the same side, or
 * "none" on a small-swing moment = missing-details. Everything else,
 * including any pick on a control stream, = incorrect.
 */
export function gradeStreamPick(
  stream: Stream,
  pick: StreamPick,
  options: Partial<StreamOptions> = {},
): StreamGrade {
  const opts = { ...DEFAULT_STREAM_OPTIONS, ...options };
  if (stream.answerPly === null) return pick === "none" ? "correct" : "incorrect";
  if (pick === "none") return stream.swing < opts.inaccuracySwing ? "missing-details" : "incorrect";
  if (pick === stream.answerPly) return "correct";
  const inStream = stream.plies.some((p) => p.ply === pick && p.selectable);
  if (inStream && Math.abs(pick - stream.answerPly) === 2) return "missing-details";
  return "incorrect";
}

/** Where the board should jump after a pick: the position before the picked (or true) move. */
export function streamJumpPly(stream: Stream, pick: StreamPick): number {
  if (typeof pick === "number" && stream.plies.some((p) => p.ply === pick)) return pick;
  return stream.answerPly ?? stream.plies[stream.plies.length - 1].ply;
}

export interface StreamSetOptions extends Partial<StreamOptions> {
  /** Max streams to return (default: all criticals plus their controls). */
  count?: number;
}

/**
 * A review session's worth of streams: criticals ordered big swing first
 * (the difficulty knob), with a control dropped in after every 2 or 3 of
 * them, so roughly one stream in 3-4 has no moment.
 */
export function buildStreamSet(
  records: MomentRecord[],
  seed: number | string,
  options: StreamSetOptions = {},
): Stream[] {
  const { count, ...streamOpts } = options;
  const rnd = seededRandom(`set|${seed}`);
  const criticals = records
    .filter((r) => momentKind(r) === "critical")
    .sort((a, b) => b.moment.winProbBefore - b.moment.winProbAfter - (a.moment.winProbBefore - a.moment.winProbAfter));
  const controls = shuffle(
    records.filter((r) => momentKind(r) === "control"),
    rnd,
  );
  const out: Stream[] = [];
  let ci = 0;
  let ki = 0;
  let untilControl = 2 + Math.floor(rnd() * 2);
  // Controls only fill the gaps between criticals; leftovers are not appended.
  while (ci < criticals.length) {
    if (count !== undefined && out.length >= count) break;
    const takeControl = ki < controls.length && untilControl === 0;
    if (takeControl) {
      out.push(buildStream(controls[ki++], seed, streamOpts));
      untilControl = 2 + Math.floor(rnd() * 2);
    } else {
      out.push(buildStream(criticals[ci++], seed, streamOpts));
      untilControl--;
    }
  }
  return out;
}
