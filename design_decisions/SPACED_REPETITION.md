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

## Review forms with conversation

Two forms are LLM-heavier than the ladder. Both grade on a three-point scale: **incorrect / missing details / correct**. Both end by dropping into the hint ladder, so "how to improve" is the existing flow.

### Form A: explain the idea (level 1)

The player writes one or two sentences: what is the plan, where on the board, and what is the opponent up to.

Ground truth comes from /label, three fields per moment:
- idea tag (what to do)
- zone squares (where)
- opponent motif (what they threaten / what makes the idea work)

Grading is extract-then-compare, so the LLM never decides correctness:
1. Haiku extracts claims from the answer as JSON: `{ ideas: string[], squares: string[], pieces: string[], opponentThreats: string[] }`. Any square or SAN it extracts is validated with chess.js; invalid ones are dropped.
2. Pure code scores each dimension hit / partial / miss against the labels (idea by tag match on the motif level, zone by square overlap, opponent motif by tag match).
3. Fixed rule for the overall grade:
   - idea miss -> **incorrect**
   - idea hit, zone or opponent motif not hit -> **missing details**
   - all three hit -> **correct**

Conversation, bounded:
- After the grade the coach asks at most one follow-up, aimed at the weakest dimension ("You saw the pin. What is White threatening on the kingside?"). The follow-up is regraded on the same rubric and can raise the grade one step.
- Max two player turns, then the ladder starts at a level set by the grade (correct -> level 2, missing details -> level 3, incorrect -> level 4).

Eval: frozen player answers per case (3-4 per moment, one per grade plus a vague one) with hand grades. Metric is judge agreement with the hand grade, target >= 90%. This is the verbal-reasoning test and the model-engineering showcase: structured extraction, validation, deterministic rubric, measured agreement.

### Form B: find the moment (level 0)

The player gets a stream of 6-12 plies, no eval bar, no symbols, and must say which move was the inaccuracy, or "none".

Stream construction, deterministic from the scan output:
- Window ends 0-4 plies after the critical move, offset chosen by seeded random so the moment can be first, last or in between.
- Streams start from a quiet position (no eval swing in the 2 plies before the window start).
- One in three or four streams is a control: a window with no moment, where "none" is correct.
- Only the player's own moves are candidates; opponent moves are shown but not selectable.

Grading:
- exact ply -> **correct**
- off by one move by the same side, or "none" on a stream whose moment is under the inaccuracy threshold -> **missing details**
- anything else, including a pick on a control stream -> **incorrect**

Then the board jumps to the picked (or true) position and the ladder continues, starting at level 2 after correct, level 4 otherwise.

Difficulty knob: the eval swing of the moment. Big swings first, smaller swings as the player graduates items.

Eval: deterministic, no LLM. Unit tests on stream construction (moment inside the window, quiet start, control ratio) and on grading.

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

- Extracts claims from the level-1 idea answer (Haiku, structured JSON). Code does the comparing and grading.
- Writes the one follow-up question, given the dimension that was missed.
- Proposes perturbations (one piece change, with a reason). Never decides if they are valid.
- Writes the one-line context for level 5 from the PGN.

Everything else is engine plus pure functions.

## Scope

v0 (demo):
- Levels 5, 4, 2, 1 and 0 (find the moment, with control streams). Siblings when a tag has 2+ moments, else idea question. Color-swap perturbation only.
- Form A with the three-field rubric and one follow-up turn.
- Virtual clock, skip-to-future button, Review tab serving due items.
- JSONL logging with the fields above.

Later:
- Level 3 (capped ladder).
- LLM-proposed perturbations with engine validation.
- Memorization detector tuning from logged `msToFirstAttempt`.

## Open questions

- Idea tag granularity: "pin" is too coarse to find siblings, "pin on the f6 knight by Bg5" too fine. Suggest two levels, motif and plan, and match siblings on motif. The /label page needs the opponent-motif field and zone squares for Form A.
- Stream length and offset for Form B: start with 8 plies and 0-4 offset, tune from logged accuracy.
- Should level 5 context include the player's own stated reasoning from the lesson (NEXT_STEPS item 3)? Likely yes, it is the cheapest "what were you thinking" context.
- Grade for "right idea, wrong move": count as grade with a +1 penalty rather than a miss.
