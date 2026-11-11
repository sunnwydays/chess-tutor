# Spaced repetition (draft plan)

Spaced repetition is the hint ladder run again later with less assistance. Same engine, same coach, same validation. What changes is how much help the player starts with and which position they see.

## Goal

A missed idea comes back until the player finds it with no help in a position they have not seen before. Progress means less assistance than last time. Graduation means zero assistance on a position that is not the original.

## The assistance dial

One axis, high to low. A review starts lower on the dial each time.

| Level | What the player sees |
|---|---|
| 5 | Game context (last 4-6 moves played, one line of "what you were doing"), position, full hint ladder available |
| 4 | Position only, full hint ladder available |
| 3 | Position only, ladder starts at the zone rung and cannot go past "name the piece" |
| 2 | Position only, attempt only, no hints |
| 1 | Idea question: "what is the plan here?" one line, no move required |
| 0 | Find the moment: the last 8-10 moves replay and the player stops the stream at the critical moment, then attempts |

Grade for a rep = starting level + hints taken. Lower is better.

Level 0 is the transfer skill (noticing a critical moment without being told) and absorbs the control-position idea: some streams contain no moment and "nothing here" is the right answer.

## Anti-memorization

Serve the original position at most once in review. After that, in order of preference:

1. **Sibling**: a different moment from the player's own games with the same idea tag. Comes from the scan output plus /label idea tags. Best option, cannot be memorized.
2. **Perturbed**: the original with a small change that keeps the idea.
   - Deterministic: swap colors (exact), horizontal mirror (only when no castling rights).
   - LLM-proposed: move or remove one piece that is not part of the idea. Stockfish must confirm the same idea is still best and the eval gap to the second idea is within ~30% of the original. Reject otherwise. Engine judges, LLM proposes.
3. **Idea question** (level 1) on the original, when no sibling or valid perturbation exists.

Memorization detector: correct at level 2 or lower in under ~5 s on the original position. Mark the rep as "recalled, not understood", keep the item in the queue, and serve a sibling next.

## Schedule

Leitner boxes with a virtual clock.

- Box 0 (missed in the lesson) -> due +1 d -> box 1 -> due +3 d -> box 2 -> due +7 d -> graduated.
- Move up a box when grade < last grade, or grade == 0.
- Stay when grade == last grade.
- Move down when grade > last grade.
- Graduate only from a sibling or perturbed rep at grade 0.

Demo: the clock is virtual. A "skip to the future" button advances it to the next due date. A session is 3-4 reps in a couple of minutes. The real-time version is the same code with the clock set to `Date.now()`.

## Data model (localStorage for now, per working notes)

```ts
type ReviewItem = {
  id: string;            // original moment id
  ideaTag: string;       // from /label
  originalFen: string;
  positions: {           // what has been served and what is available
    fen: string;
    kind: "original" | "sibling" | "perturbed";
    sourceGame?: string;
  }[];
  box: 0 | 1 | 2 | 3;    // 3 = graduated
  dueAt: number;         // virtual ms
  history: ReviewRep[];
};

type ReviewRep = {
  at: number;            // virtual ms
  positionKind: "original" | "sibling" | "perturbed";
  startLevel: 0 | 1 | 2 | 3 | 4 | 5;
  hintsTaken: number;
  grade: number;         // startLevel + hintsTaken
  verdict: "right-idea" | "right-move" | "wrong" | "noticed" | "missed";
  msToFirstAttempt: number;
  memorizedFlag: boolean;
};
```

## Logging (JSONL, one row per interaction)

Same log as the lesson. Add: `mode: "lesson" | "review"`, `reviewItemId`, `positionKind`, `startLevel`, `virtualClock`. The A/B metrics in working_notes (time guessing, hint count, success rate, moves explored) all come from this file.

## What the LLM does here

- Grades the level-1 idea answer against the idea tag (Haiku, structured verdict, cites the tag it matched).
- Proposes perturbations (one piece change, with a reason). Never decides if they are valid.
- Writes the one-line context for level 5 from the PGN.

Everything else is engine plus pure functions.

## Scope

v0 (demo):
- Levels 5, 4, 2, 1. Siblings when a tag has 2+ moments, else idea question. Color-swap perturbation only.
- Virtual clock, skip-to-future button, Review tab serving due items.
- JSONL logging with the fields above.

Later:
- Level 3 (capped ladder) and level 0 (find the moment, with no-moment control streams).
- LLM-proposed perturbations with engine validation.
- Memorization detector tuning from logged `msToFirstAttempt`.

## Open questions

- Idea tag granularity: "pin" is too coarse to find siblings, "pin on the f6 knight by Bg5" too fine. Suggest two levels, motif and plan, and match siblings on motif.
- Should level 5 context include the player's own stated reasoning from the lesson (NEXT_STEPS item 3)? Likely yes, it is the cheapest "what were you thinking" context.
- Grade for "right idea, wrong move": count as grade with a +1 penalty rather than a miss.
