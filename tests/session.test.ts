import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { createItem, recordRep } from "@/lib/review/queue";
import { levelFor, rungsFor, toRep } from "@/lib/review/session";
import { colorSwapMoment, ideaTag, swapLine } from "@/lib/review/sources";
import type { MomentAnalysis } from "@/lib/engine/types";
import type { MomentLabel } from "@/lib/moments";

const FEN = "r3k2r/pp3ppp/2p1pn2/4n3/3qP3/3B1Q2/PPPB2PP/2KR1R2 w kq - 4 13";
const has = { ideaLabel: true, stream: true };

describe("levelFor", () => {
  it("walks 5 -> 1 -> 0 as the item climbs boxes, 4 after a miss", () => {
    let item = createItem("x", "fork", FEN, 0);
    expect(levelFor(item, has)).toBe(5);
    item = recordRep(item, toRep({ startLevel: 5, positionKind: "original", ladder: { solved: false, hintsTaken: 2, msToFirstAttempt: 9000 } }), 0);
    expect(item.box).toBe(0);
    expect(levelFor(item, has)).toBe(4);
    item = { ...item, box: 1 };
    expect(levelFor(item, has)).toBe(1);
    expect(levelFor(item, { ideaLabel: false, stream: true })).toBe(2);
    item = { ...item, box: 2 };
    expect(levelFor(item, has)).toBe(0);
    expect(levelFor(item, { ideaLabel: true, stream: false })).toBe(2);
  });

  it("caps the ladder by level", () => {
    expect(rungsFor(4)).toContain("move");
    expect(rungsFor(3)).toEqual(["focus", "threat", "piece"]);
    expect(rungsFor(2)).toEqual([]);
  });
});

describe("toRep", () => {
  it("right-move only with zero hints", () => {
    expect(toRep({ startLevel: 4, positionKind: "sibling", ladder: { solved: true, hintsTaken: 0, msToFirstAttempt: 8000 } }).verdict).toBe("right-move");
    expect(toRep({ startLevel: 4, positionKind: "sibling", ladder: { solved: true, hintsTaken: 1, msToFirstAttempt: 8000 } }).verdict).toBe("wrong");
  });
  it("forms set the verdict and grade = level + hints", () => {
    const a = toRep({ startLevel: 1, positionKind: "original", ideaGrade: "correct", ladder: { solved: true, hintsTaken: 0, msToFirstAttempt: 8000 } });
    expect(a.verdict).toBe("right-idea");
    const b = toRep({ startLevel: 0, positionKind: "original", findGrade: "incorrect", ladder: { solved: true, hintsTaken: 2, msToFirstAttempt: 8000 } });
    expect(b.verdict).toBe("missed");
    expect(b.grade).toBe(2);
  });
  it("flags a fast correct answer on the original as memorized", () => {
    expect(toRep({ startLevel: 2, positionKind: "original", ladder: { solved: true, hintsTaken: 0, msToFirstAttempt: 2000 } }).memorizedFlag).toBe(true);
    expect(toRep({ startLevel: 2, positionKind: "sibling", ladder: { solved: true, hintsTaken: 0, msToFirstAttempt: 2000 } }).memorizedFlag).toBe(false);
  });
});

describe("color swap", () => {
  it("mirrors SAN through the swapped position", () => {
    expect(swapLine(FEN, ["Qg3", "Nxd3+"])).toEqual(["Qg6", "Nxd6+"]);
  });
  it("keeps evals and makes every line legal in the new position", () => {
    const m: MomentAnalysis = {
      ply: 25,
      fenBefore: FEN,
      played: "Qe2",
      evalBefore: 50,
      evalAfter: -80,
      winProbBefore: 55,
      winProbAfter: 40,
      lines: [{ move: "Qg3", evalCp: 40, mate: null, pv: ["Qg3", "Ng6", "Rde1"] }],
    };
    const s = colorSwapMoment(m);
    expect(s.ply).toBe(26);
    expect(s.evalBefore).toBe(50);
    expect(s.played).toBe("Qe7");
    const c = new Chess(s.fenBefore);
    for (const san of s.lines[0].pv) c.move(san);
  });
});

describe("ideaTag", () => {
  const label = (idea: string): MomentLabel => ({ id: "x", tags: [], notes: "", updatedAt: "t", idea });
  it("takes the most specific motif from the label idea", () => {
    expect(ideaTag(label("Don't get forked"))).toBe("fork");
    expect(ideaTag(label("Taking the pawn and moving your rook out of skewer danger"))).toBe("skewer");
  });
  it("falls back to the coach motif, then untagged", () => {
    expect(ideaTag(undefined, "back-rank weakness")).toBe("back-rank");
    expect(ideaTag(undefined)).toBe("untagged");
  });
});
