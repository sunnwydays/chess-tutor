# Spaced repetition

Spaced repetition is the hint ladder run again later with less help. Same engine, same coach, same validation. What changes is how much help the player starts with and which position they see.

**Goal:** a missed idea keeps coming back until the player finds it with no help, ideally in a position they haven't seen before.

## The assistance dial

One axis, high to low. Each box in the queue starts lower on the dial.

| Level | What the player sees | Used for |
|---|---|---|
| 5 | The moves leading up to the position, then the full ladder | Box 0, first review |
| 4 | Position only, full ladder | Box 0 after a miss |
| 3 | Position only, hints up to the piece | After a "missing details" idea answer |
| 2 | Position only, one try, no hints | Box 1 or 2 when Form A or B can't run; after a correct form answer |
| 1 | **Form A:** explain the idea in a line, no move | Box 1 |
| 0 | **Form B:** find the moment in a stream of moves | Box 2 |

Both forms end by dropping into the ladder at the position, so "how to improve" is the existing flow.

## Form A: explain the idea (level 1)

The player writes a line: the plan, where on the board, and what the opponent is up to. The ground truth is three fields from `/label`: idea tag, zone squares, opponent motif.

Grading is extract-then-compare, so the LLM never decides correctness ([rubric.ts](../src/lib/review/rubric.ts)):

1. Haiku extracts claims as JSON: `{ ideas, squares, pieces, opponentThreats }`. chess.js drops squares and pieces that aren't on the board.
2. Pure code scores each dimension hit / partial / miss against the label (idea by motif tag, zone by square overlap, opponent motif by tag).
3. Fixed rule: idea miss -> **incorrect**; idea hit but zone or motif not -> **missing details**; all three -> **correct**.

One follow-up question, built from a template for the weakest dimension so it can't leak the answer. The second answer can raise the grade one step. Then the ladder starts at level 2 (correct), 3 (missing details) or 4 (incorrect).

Eval: 32 frozen answers over 8 labelled moments, hand graded. Agreement 30/32 (target >= 90%).

## Form B: find the moment (level 0)

The player steps through 6-12 plies with no eval and picks which of their own moves was the mistake, or "nothing wrong" ([streams.ts](../src/lib/review/streams.ts)).

- The window ends 0-4 plies after the moment, with a seeded offset so the moment isn't always last.
- It starts from a quiet position (no big swing in the 2 plies before).
- Only the player's own moves can be picked.

Grading: the exact ply -> **correct**; one move off, or "nothing wrong" on a small-swing moment -> **missing details**; anything else, including any pick on a control stream -> **incorrect**. Then the ladder at that position: level 2 after correct, 4 otherwise. Deterministic and unit-tested, no LLM.

## Schedule

Leitner boxes on a virtual clock ([queue.ts](../src/lib/review/queue.ts)):

- A lesson moment not found on the first try without hints enters box 0, due now.
- Success moves the item up one box: box 1 due in 1 day, box 2 in 3 days, box 3 is learned and leaves the queue. A miss sends it back to box 0.
- **Success** means Form A correct, Form B correct, or, when no form ran, the ladder solved on the first try with no hints. A form grade outranks the ladder.
- A session is up to 4 reps, one of them a control stream (slot 2) where "nothing wrong" is right. The control result is logged only.
- "Skip to the future" jumps the clock to the next due date, so a demo shows several days of reviews in a couple of minutes. The real-time version is the same code with `Date.now()`.

## Anti-memorization

The original position is served once. After that:

1. **Sibling:** another of the player's moments with the same idea tag. The tag is the most specific motif in the label's idea text (else the coach's motif tag). 26 of 31 labelled moments have one.
2. **Color swap** of the original: exact, so the idea is unchanged.

Memorization check: a correct answer at level 2 or lower in under 5 s on the original. That rep keeps the item in its box instead of promoting it.

## Data model

```ts
type ReviewItem = {
  id: string;            // original moment id
  ideaTag: string;
  originalFen: string;
  positions: { fen: string; kind: "original" | "sibling" | "perturbed"; sourceGame?: string; momentId?: string }[];
  box: 0 | 1 | 2 | 3;    // 3 = learned
  dueAt: number;         // virtual ms
  history: ReviewRep[];
};

type ReviewRep = {
  at: number;
  positionKind: "original" | "sibling" | "perturbed";
  startLevel: 0 | 1 | 2 | 3 | 4 | 5;
  hintsTaken: number;
  grade: number;         // startLevel + hintsTaken
  verdict: "right-idea" | "right-move" | "wrong" | "noticed" | "missed";
  msToFirstAttempt: number;
  memorizedFlag: boolean;
};
```

Stored in localStorage. Every rep is also a JSONL log row with `mode: "review"`, `reviewItemId`, `positionKind`, `level` and `virtualClock`.

## Changed from the first plan

- **Simpler promotion.** The plan moved items by comparing the grade with the last rep's grade. Built: success promotes, a miss resets, which is easier to explain and test. `grade` is still logged for tuning.
- **Graduation from any position.** The plan only graduated on a sibling or perturbed position at grade 0. Built: box 2 success graduates.
- **Only exact perturbations.** LLM-proposed perturbations (move one piece, engine confirms the idea holds) and the horizontal mirror weren't built. Color swap is.
- **Level 5 context is a steppable replay** of the game up to the position, not an LLM-written line.
- **One control per session** instead of one in every 3-4 streams.

## Open questions

- Idea tag granularity: "pin" is too coarse to find good siblings, "pin on the f6 knight by Bg5" too fine. Two levels (motif and plan) with siblings matched on motif is the likely answer.
- Stream length and offset for Form B: tune from logged accuracy.
- Should level 5 include the player's own reasoning from the lesson (NEXT_STEPS item 3)? Likely yes; it's the cheapest "what were you thinking" context.
- "Right idea, wrong move": count it as a pass with a penalty instead of a miss?
