import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { MomentRecord } from "@/lib/moments";
import { buildStream, buildStreamSet, gradeStreamPick, isUserPly, type Stream } from "@/lib/review/streams";

// A real 82-ply game (user = black) so every start FEN is reachable.
const MOVES = [
  "c4","c6","Nc3","d5","d4","Bf5","Nf3","e6","e3","Nf6","Nh4","Bg6","Nxg6","hxg6","Qb3","Qb6","Qxb6","axb6","Bd3","c5",
  "Ne2","Bd6","h3","Nc6","a3","cxd4","Nxd4","Nxd4","exd4","Rh4","Be3","Ra4","c5","bxc5","dxc5","Be5","Rb1","Bd4","Bb5+","Ke7",
  "Bxa4","Bxe3","fxe3","Rxa4","O-O","Ne4","Rbc1","Ra5","b4","Rxa3","Rfd1","Rxe3","b5","Kd7","c6+","bxc6","bxc6+","Kc7","Rd4","Rc3",
  "Rdd1","Rxc6","Rxc6+","Kxc6","Rc1+","Kd6","Rf1","f5","Rd1","Ke5","Kf1","g5","Ke2","f4","Kf3","g6","Rd3","d4","Ke2","Kd5",
  "Rd1","Nc3+",
];

/** Flat eval series with one drop of `swing` at `ply` (user POV, black). */
function flatWinProbs(drops: Record<number, number>, loud: number[] = []): number[] {
  const wp: number[] = [50];
  for (let p = 1; p <= MOVES.length; p++) {
    let v = wp[p - 1];
    if (drops[p]) v -= drops[p];
    if (loud.includes(p)) v += 15;
    wp.push(v);
  }
  return wp;
}

function record(opts: {
  ply: number;
  kind: "critical" | "control";
  swing?: number;
  winProbs?: number[];
  criticalPlies?: number[];
}): MomentRecord {
  const swing = opts.swing ?? 25;
  const chess = new Chess();
  for (let i = 0; i < opts.ply - 1; i++) chess.move(MOVES[i]);
  return {
    id: `g1-${opts.ply}`,
    kind: opts.kind,
    game: {
      id: "g1",
      url: "",
      endTime: 0,
      timeClass: "rapid",
      white: { username: "x", rating: 1500 },
      black: { username: "me", rating: 1500 },
      result: "loss",
      userColor: "black",
      moves: MOVES,
      winProbs: opts.winProbs ?? flatWinProbs(opts.kind === "critical" ? { [opts.ply]: swing } : {}),
      criticalPlies: opts.criticalPlies ?? (opts.kind === "critical" ? [opts.ply] : []),
    },
    moment: {
      ply: opts.ply,
      fenBefore: chess.fen(),
      played: MOVES[opts.ply - 1],
      evalBefore: 0,
      evalAfter: 0,
      winProbBefore: 50,
      winProbAfter: opts.kind === "critical" ? 50 - swing : 50,
      lines: [],
    },
  };
}

function replayOk(s: Stream): boolean {
  const chess = new Chess(s.startFen);
  for (const p of s.plies) chess.move(p.san);
  return true;
}

describe("buildStream", () => {
  const rec = record({ ply: 32, kind: "critical" });

  it("puts the moment inside a 6-12 ply window ending 0-4 plies after it", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = buildStream(rec, seed);
      const first = s.plies[0].ply;
      const last = s.plies[s.plies.length - 1].ply;
      expect(s.plies.length).toBeGreaterThanOrEqual(6);
      expect(s.plies.length).toBeLessThanOrEqual(12);
      expect(first).toBeLessThanOrEqual(32);
      expect(last).toBeGreaterThanOrEqual(32);
      expect(last - 32).toBeLessThanOrEqual(4);
      expect(s.answerPly).toBe(32);
      expect(replayOk(s)).toBe(true);
    }
  });

  it("varies the offset across seeds so the moment is not always last", () => {
    const offsets = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const s = buildStream(rec, seed);
      offsets.add(s.plies[s.plies.length - 1].ply - 32);
    }
    expect(offsets.size).toBeGreaterThan(2);
  });

  it("is deterministic for a given seed", () => {
    expect(buildStream(rec, "abc")).toEqual(buildStream(rec, "abc"));
  });

  it("only marks the user's moves selectable", () => {
    const s = buildStream(rec, 1);
    for (const p of s.plies) expect(p.selectable).toBe(isUserPly(p.ply, "black"));
    expect(s.plies.filter((p) => p.selectable).every((p) => p.ply % 2 === 0)).toBe(true);
  });

  it("starts quiet: no big swing in the 2 plies before the window", () => {
    // Loud plies 20-28: the window must start after 30 or well before 20.
    const loud = [20, 21, 22, 23, 24, 25, 26, 27, 28];
    const r = record({ ply: 32, kind: "critical", winProbs: flatWinProbs({ 32: 25 }, loud) });
    for (let seed = 0; seed < 30; seed++) {
      const s = buildStream(r, seed);
      const start = s.plies[0].ply;
      for (const l of loud) expect([start - 1, start - 2]).not.toContain(l);
    }
  });

  it("keeps a second critical moment out of the window", () => {
    const r = record({ ply: 32, kind: "critical", criticalPlies: [26, 32], winProbs: flatWinProbs({ 26: 20, 32: 25 }) });
    for (let seed = 0; seed < 30; seed++) {
      const s = buildStream(r, seed);
      expect(s.plies.some((p) => p.ply === 26)).toBe(false);
    }
  });

  it("builds control streams with no answer and no user error inside", () => {
    const r = record({ ply: 40, kind: "control", criticalPlies: [32], winProbs: flatWinProbs({ 32: 25 }) });
    for (let seed = 0; seed < 30; seed++) {
      const s = buildStream(r, seed);
      expect(s.kind).toBe("control");
      expect(s.answerPly).toBeNull();
      expect(s.plies.some((p) => p.ply === 32)).toBe(false);
      expect(replayOk(s)).toBe(true);
    }
  });
});

describe("gradeStreamPick", () => {
  const big = buildStream(record({ ply: 32, kind: "critical", swing: 30 }), 7);
  const small = buildStream(record({ ply: 32, kind: "critical", swing: 12 }), 7);
  const control = buildStream(record({ ply: 40, kind: "control" }), 7);

  it("exact ply is correct", () => {
    expect(gradeStreamPick(big, 32)).toBe("correct");
  });
  it("off by one move of the same side is missing-details", () => {
    expect(gradeStreamPick(big, 30)).toBe("missing-details");
    expect(gradeStreamPick(big, 34)).toBe("missing-details");
  });
  it("off by two moves, or an opponent ply, is incorrect", () => {
    expect(gradeStreamPick(big, 28)).toBe("incorrect");
    expect(gradeStreamPick(big, 31)).toBe("incorrect");
    expect(gradeStreamPick(big, 999)).toBe("incorrect");
  });
  it("'none' is incorrect on a big swing, missing-details on a small one", () => {
    expect(gradeStreamPick(big, "none")).toBe("incorrect");
    expect(gradeStreamPick(small, "none")).toBe("missing-details");
  });
  it("control: 'none' is correct, any pick is incorrect", () => {
    expect(gradeStreamPick(control, "none")).toBe("correct");
    expect(gradeStreamPick(control, 40)).toBe("incorrect");
  });
});

describe("buildStreamSet", () => {
  it("mixes in about one control per 3-4 streams, biggest swings first", () => {
    const records: MomentRecord[] = [];
    for (let i = 0; i < 24; i++) {
      const ply = 20 + 2 * i;
      records.push({ ...record({ ply, kind: "critical", swing: 10 + i }), id: `c${i}` });
    }
    for (let i = 0; i < 12; i++) {
      records.push({ ...record({ ply: 20 + 2 * i, kind: "control" }), id: `k${i}` });
    }
    const set = buildStreamSet(records, 3);
    const controls = set.filter((s) => s.kind === "control").length;
    const ratio = controls / set.length;
    expect(ratio).toBeGreaterThanOrEqual(1 / 4.5);
    expect(ratio).toBeLessThanOrEqual(1 / 2.5);
    const swings = set.filter((s) => s.kind === "critical").map((s) => s.swing);
    expect(swings).toEqual([...swings].sort((a, b) => b - a));
    // No two controls back to back.
    for (let i = 1; i < set.length; i++) {
      expect(set[i].kind === "control" && set[i - 1].kind === "control").toBe(false);
    }
  });
});
