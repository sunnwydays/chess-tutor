/** Leitner review queue on a virtual clock. Pure functions plus a thin localStorage layer. */

export type PositionKind = "original" | "sibling" | "perturbed";

export type ReviewRep = {
  at: number; // virtual ms
  positionKind: PositionKind;
  startLevel: 0 | 1 | 2 | 3 | 4 | 5;
  hintsTaken: number;
  grade: number; // startLevel + hintsTaken
  verdict: "right-idea" | "right-move" | "wrong" | "noticed" | "missed";
  msToFirstAttempt: number;
  memorizedFlag: boolean;
};

export type ReviewItem = {
  id: string; // original moment id
  ideaTag: string; // from /label
  originalFen: string;
  positions: {
    fen: string;
    kind: PositionKind;
    sourceGame?: string;
  }[];
  box: 0 | 1 | 2 | 3; // 3 = graduated
  dueAt: number; // virtual ms
  history: ReviewRep[];
};

export type QueueState = { items: ReviewItem[]; clock: number };

const DAY = 24 * 60 * 60 * 1000;

/** Box -> time until due after a rep. Box 3 is graduated and never due. */
export const BOX_INTERVALS_MS = [0, 1 * DAY, 3 * DAY, 7 * DAY];

const STORAGE_KEY = "chess-tutor-review";

/** New item in box 0, due immediately. */
export function createItem(
  id: string,
  ideaTag: string,
  originalFen: string,
  now: number,
  extraPositions: ReviewItem["positions"] = [],
): ReviewItem {
  return {
    id,
    ideaTag,
    originalFen,
    positions: [{ fen: originalFen, kind: "original" }, ...extraPositions],
    box: 0,
    dueAt: now,
    history: [],
  };
}

function dueAtFor(box: number, now: number): number {
  return box >= 3 ? Infinity : now + BOX_INTERVALS_MS[box];
}

/** Record a rep and return a new item. Success promotes one box, failure resets to 0. */
export function recordRep(
  item: ReviewItem,
  rep: Omit<ReviewRep, "at">,
  now: number,
): ReviewItem {
  const success =
    rep.verdict === "right-move" ||
    rep.verdict === "right-idea" ||
    rep.verdict === "noticed";
  let box: number;
  if (!success) box = 0;
  else if (rep.memorizedFlag) box = item.box;
  else box = Math.min(3, item.box + 1);
  return {
    ...item,
    box: box as ReviewItem["box"],
    dueAt: dueAtFor(box, now),
    history: [...item.history, { at: now, ...rep }],
  };
}

/** Anti-memorization order: original once, then unseen siblings, then unseen perturbed, else original. */
export function nextPosition(item: ReviewItem): ReviewItem["positions"][number] | null {
  const original = item.positions.find((p) => p.kind === "original") ?? null;
  const served = (kind: PositionKind) =>
    item.history.filter((h) => h.positionKind === kind).length;
  if (original && served("original") === 0) return original;
  for (const kind of ["sibling", "perturbed"] as const) {
    const available = item.positions.filter((p) => p.kind === kind);
    const n = served(kind);
    if (n < available.length) return available[n];
  }
  return original;
}

/** Swap colors: flip the board vertically, swap piece case, side to move, castling and en passant. */
export function colorSwapFen(fen: string): string {
  const [board, side, castling, ep, ...rest] = fen.trim().split(/\s+/);
  const swapCase = (c: string) =>
    c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
  const newBoard = board
    .split("/")
    .reverse()
    .map((rank) =>
      rank
        .split("")
        .map((c) => (/[a-z]/i.test(c) ? swapCase(c) : c))
        .join(""),
    )
    .join("/");
  const newSide = side === "w" ? "b" : "w";
  let newCastling = "-";
  if (castling && castling !== "-") {
    const swapped = castling.split("").map(swapCase);
    newCastling = ["K", "Q", "k", "q"].filter((c) => swapped.includes(c)).join("") || "-";
  }
  const newEp = ep && ep !== "-" ? ep[0] + (9 - Number(ep[1])) : "-";
  return [newBoard, newSide, newCastling, newEp, ...rest].join(" ");
}

/** Due item with the smallest dueAt; ties go to the lower box. */
export function nextDue(items: ReviewItem[], now: number): ReviewItem | null {
  let best: ReviewItem | null = null;
  for (const it of items) {
    if (it.box >= 3 || it.dueAt > now) continue;
    if (!best || it.dueAt < best.dueAt || (it.dueAt === best.dueAt && it.box < best.box)) {
      best = it;
    }
  }
  return best;
}

/** How many items are due at `now`. */
export function dueCount(items: ReviewItem[], now: number): number {
  return items.filter((it) => it.box < 3 && it.dueAt <= now).length;
}

/** Next virtual time something becomes due; `now` if something is due already or nothing is pending. */
export function skipToFuture(items: ReviewItem[], now: number): number {
  if (dueCount(items, now) > 0) return now;
  let min = Infinity;
  for (const it of items) {
    if (it.box < 3 && it.dueAt > now && it.dueAt < min) min = it.dueAt;
  }
  return min === Infinity ? now : min;
}

/** Read the queue from localStorage; empty queue with the real clock if unavailable. */
export function loadQueue(): QueueState {
  const fallback = { items: [], clock: Date.now() };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<QueueState>;
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map((it) => ({
      ...it,
      // JSON turns Infinity into null
      dueAt: it.dueAt == null ? Infinity : it.dueAt,
    }));
    return { items, clock: typeof parsed.clock === "number" ? parsed.clock : Date.now() };
  } catch {
    return fallback;
  }
}

/** Write the queue to localStorage; silently ignores failures. */
export function saveQueue(state: QueueState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked
  }
}
