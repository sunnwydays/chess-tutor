import { describe, it, expect } from "vitest";
import {
  BOX_INTERVALS_MS,
  colorSwapFen,
  createItem,
  dueCount,
  nextDue,
  nextPosition,
  recordRep,
  skipToFuture,
  type ReviewRep,
} from "../src/lib/review/queue";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const DAY = 24 * 60 * 60 * 1000;

function rep(over: Partial<Omit<ReviewRep, "at">> = {}): Omit<ReviewRep, "at"> {
  return {
    positionKind: "original",
    startLevel: 0,
    hintsTaken: 0,
    grade: 0,
    verdict: "right-move",
    msToFirstAttempt: 8000,
    memorizedFlag: false,
    ...over,
  };
}

describe("recordRep", () => {
  it("promotes through boxes and graduates", () => {
    let it = createItem("a", "fork", START, 0);
    expect(it.box).toBe(0);
    expect(it.dueAt).toBe(0);
    it = recordRep(it, rep(), 0);
    expect(it.box).toBe(1);
    expect(it.dueAt).toBe(BOX_INTERVALS_MS[1]);
    it = recordRep(it, rep({ verdict: "right-idea" }), DAY);
    expect(it.box).toBe(2);
    expect(it.dueAt).toBe(DAY + 3 * DAY);
    it = recordRep(it, rep({ verdict: "noticed" }), 4 * DAY);
    expect(it.box).toBe(3);
    expect(it.history).toHaveLength(3);
    expect(it.history[2].at).toBe(4 * DAY);
  });

  it("demotes to box 0 on failure", () => {
    let it = createItem("a", "fork", START, 0);
    it = recordRep(it, rep(), 0);
    it = recordRep(it, rep(), DAY);
    expect(it.box).toBe(2);
    it = recordRep(it, rep({ verdict: "wrong" }), 4 * DAY);
    expect(it.box).toBe(0);
    expect(it.dueAt).toBe(4 * DAY);
    it = recordRep(it, rep({ verdict: "missed" }), 4 * DAY);
    expect(it.box).toBe(0);
  });

  it("is pure", () => {
    const it = createItem("a", "fork", START, 0);
    recordRep(it, rep(), 0);
    expect(it.box).toBe(0);
    expect(it.history).toHaveLength(0);
  });

  it("graduated items are never due", () => {
    let it = createItem("a", "fork", START, 0);
    for (let i = 0; i < 3; i++) it = recordRep(it, rep(), i * DAY);
    expect(it.box).toBe(3);
    expect(it.dueAt).toBe(Infinity);
    expect(nextDue([it], 1e15)).toBeNull();
    expect(dueCount([it], 1e15)).toBe(0);
    expect(skipToFuture([it], 5)).toBe(5);
  });

  it("memorizedFlag blocks promotion but still schedules", () => {
    let it = createItem("a", "fork", START, 0);
    it = recordRep(it, rep(), 0);
    const flagged = recordRep(it, rep({ memorizedFlag: true }), DAY);
    expect(flagged.box).toBe(1);
    expect(flagged.dueAt).toBe(DAY + BOX_INTERVALS_MS[1]);
  });
});

describe("queue selection", () => {
  it("nextDue picks smallest dueAt, then lower box", () => {
    const a = { ...createItem("a", "x", START, 0), dueAt: 50, box: 1 as const };
    const b = { ...createItem("b", "x", START, 0), dueAt: 10, box: 2 as const };
    const c = { ...createItem("c", "x", START, 0), dueAt: 10, box: 1 as const };
    const d = { ...createItem("d", "x", START, 0), dueAt: 500, box: 0 as const };
    expect(nextDue([a, b, c, d], 100)?.id).toBe("c");
    expect(nextDue([d], 100)).toBeNull();
    expect(dueCount([a, b, c, d], 100)).toBe(3);
  });

  it("skipToFuture jumps to the next due time", () => {
    const a = { ...createItem("a", "x", START, 0), dueAt: 500, box: 1 as const };
    const b = { ...createItem("b", "x", START, 0), dueAt: 300, box: 2 as const };
    expect(skipToFuture([a, b], 100)).toBe(300);
    expect(skipToFuture([a, b], 300)).toBe(300);
    expect(skipToFuture([], 100)).toBe(100);
  });
});

describe("nextPosition", () => {
  it("serves original once, then sibling, then perturbed, then original", () => {
    const sib = { fen: "8/8/8/8/8/8/8/K6k w - - 0 1", kind: "sibling" as const };
    const per = { fen: "8/8/8/8/8/8/8/k6K w - - 0 1", kind: "perturbed" as const };
    let it = createItem("a", "x", START, 0, [sib, per]);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = nextPosition(it)!;
      order.push(p.kind);
      it = recordRep(it, rep({ positionKind: p.kind }), i);
    }
    expect(order).toEqual(["original", "sibling", "perturbed", "original"]);
  });

  it("falls back to original when no extras exist", () => {
    let it = createItem("a", "x", START, 0);
    it = recordRep(it, rep(), 0);
    expect(nextPosition(it)?.kind).toBe("original");
  });
});

describe("colorSwapFen", () => {
  it("start position maps to itself with side flipped", () => {
    expect(colorSwapFen(START)).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1",
    );
  });

  it("mirrors en passant, castling and pieces", () => {
    const fen = "r3k2r/8/8/3pP3/8/8/8/R3K3 w Kq d6 0 2";
    expect(colorSwapFen(fen)).toBe("r3k3/8/8/8/3Pp3/8/8/R3K2R b Qk d3 0 2");
  });

  it("is an involution", () => {
    const fen = "r3k2r/8/8/3pP3/8/8/8/R3K3 w Kq d6 0 2";
    expect(colorSwapFen(colorSwapFen(fen))).toBe(fen);
  });
});
