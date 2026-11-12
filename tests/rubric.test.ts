import { describe, expect, it } from "vitest";
import {
  contentTokens,
  followUpQuestion,
  grade,
  ladderLevelFor,
  motifTags,
  regrade,
  scoreClaims,
  textMatch,
  validateClaims,
  weakestDimension,
  type Claims,
  type RubricLabel,
} from "@/lib/review/rubric";

// Caro-Kann moment: Black's Ne5 forks Qf3 and Bd3; Qg3 keeps hitting e5 and g7.
const FEN = "r3k2r/pp3ppp/2p1pn2/4n3/3qP3/3B1Q2/PPPB2PP/2KR1R2 w kq - 4 13";
const LABEL: RubricLabel = {
  idea: "move the queen out of the fork with tempo, keep hitting the knight on e5",
  zone: ["e5", "d3", "f3", "g3"],
  opponentMotif: "the knight on e5 forks the queen and the bishop",
};

function claims(c: Partial<Claims>): Claims {
  return { ideas: [], squares: [], pieces: [], opponentThreats: [], ...c };
}

describe("validateClaims", () => {
  it("drops bad squares and piece refs not on the board, folds piece squares in", () => {
    const v = validateClaims(
      claims({ squares: ["e5", "z9", "E4"], pieces: ["Ne5", "Bd3", "Nd3", "Qe8", "garbage"] }),
      FEN,
    );
    expect(v.squares.sort()).toEqual(["d3", "e4", "e5"]);
    expect(v.pieces).toEqual(["Ne5", "Bd3"]);
  });
});

describe("tokens and motifs", () => {
  it("finds motif tags through synonyms", () => {
    expect(motifTags("the knight is forking my queen and bishop")).toContain("fork");
    expect(motifTags("it attacks both pieces")).toContain("fork");
    expect(motifTags("pinned knight")).toContain("pin");
    expect(motifTags("nothing here")).toEqual(new Set());
  });
  it("normalizes piece words and squares", () => {
    const t = contentTokens("The knights on e5 attack my Bd3");
    expect(t).toContain("knight");
    expect(t).toContain("e5");
    expect(t).toContain("d3");
    expect(t).toContain("bishop");
    expect(t.has("the")).toBe(false);
  });
});

describe("scoreClaims + grade", () => {
  it("full answer is correct", () => {
    const c = claims({
      ideas: ["move the queen with tempo", "attack the knight on e5 with qg3"],
      squares: ["e5", "d3", "g3"],
      pieces: ["Ne5", "Bd3"],
      opponentThreats: ["knight on e5 forks queen and bishop"],
    });
    const s = scoreClaims(c, LABEL);
    expect(s).toEqual({ idea: "hit", zone: "hit", opponentMotif: "hit" });
    expect(grade(s)).toBe("correct");
    expect(followUpQuestion(s)).toBeNull();
  });

  it("right idea, no squares, no threat is missing-details with a zone follow-up", () => {
    const c = claims({ ideas: ["move my queen so it still attacks the knight"] });
    const s = scoreClaims(c, LABEL);
    expect(s.idea).not.toBe("miss");
    expect(s.zone).toBe("miss");
    expect(grade(s)).toBe("missing-details");
    expect(weakestDimension(s)).toBe("zone");
    expect(followUpQuestion(s)).toMatch(/squares or pieces/);
  });

  it("right idea and squares but no threat asks about the opponent", () => {
    const c = claims({ ideas: ["queen to g3 hitting the knight on e5"], squares: ["g3", "e5"] });
    const s = scoreClaims(c, LABEL);
    expect(s.zone).toBe("hit");
    expect(s.opponentMotif).toBe("miss");
    expect(grade(s)).toBe("missing-details");
    expect(followUpQuestion(s)).toMatch(/opponent/);
  });

  it("threat stated as a plan gives partial motif credit, still missing-details", () => {
    const c = claims({ ideas: ["get the queen out of the knight fork on e5"], squares: ["e5", "d3"] });
    const s = scoreClaims(c, LABEL);
    expect(s.opponentMotif).toBe("partial");
    expect(grade(s)).toBe("missing-details");
  });

  it("unrelated plan is incorrect and asks for the goal", () => {
    const c = claims({ ideas: ["castle and develop the pieces"], squares: ["g1"] });
    const s = scoreClaims(c, LABEL);
    expect(s.idea).toBe("miss");
    expect(grade(s)).toBe("incorrect");
    expect(followUpQuestion(s)).toMatch(/main goal/);
  });

  it("naming one piece is not partial credit", () => {
    const c = claims({ ideas: ["tactic with the knight"] });
    expect(scoreClaims(c, LABEL).idea).toBe("miss");
  });

  it("synonyms count: 'attacks the knight' matches 'hitting the knight'", () => {
    const t = contentTokens("keep hitting the knight");
    expect(t).toContain("attack");
    const c = claims({
      ideas: ["queen must move to still attack knight", "move queen to g3", "keep bishop protected"],
      squares: ["e5", "f3", "d3", "g3"],
    });
    expect(scoreClaims(c, LABEL).idea).toBe("hit");
  });

  it("stems and escape phrases match paraphrases of Sunny's labels", () => {
    expect(textMatch(["promoting the a2 pawn"], "Promote pawn.")).toBe("hit");
    expect(textMatch(["save the knight with ne5"], "get the knight out of trouble and toward more important places")).toBe(
      "hit",
    );
    expect(
      textMatch(["black develops and stays a pawn up"], "opponent easily defends and develops, up material"),
    ).toBe("hit");
  });

  it("vague answer is incorrect", () => {
    const c = claims({ ideas: ["something tactical"] });
    expect(grade(scoreClaims(c, LABEL))).toBe("incorrect");
  });

  it("missing label fields count as n/a and do not block correct", () => {
    const c = claims({ ideas: ["move the queen with tempo hitting the knight on e5"], squares: ["e5"] });
    const s = scoreClaims(c, { idea: LABEL.idea });
    expect(s.zone).toBe("n/a");
    expect(s.opponentMotif).toBe("n/a");
    expect(grade(s)).toBe("correct");
  });
});

describe("ladder and regrade", () => {
  it("maps grades to ladder levels", () => {
    expect(ladderLevelFor("correct")).toBe(2);
    expect(ladderLevelFor("missing-details")).toBe(3);
    expect(ladderLevelFor("incorrect")).toBe(4);
  });
  it("a follow-up raises the grade by one step at most and never lowers it", () => {
    expect(regrade("incorrect", "correct")).toBe("missing-details");
    expect(regrade("missing-details", "correct")).toBe("correct");
    expect(regrade("correct", "incorrect")).toBe("correct");
    expect(regrade("incorrect", "incorrect")).toBe("incorrect");
  });
});
