# Eval findings: how the hint ladder was iterated

The coach is judged on one question above all: **does each hint help without giving the answer away?** To measure that, after every rung a second model (Haiku 5.5) sees the position plus everything the player has been shown so far, and guesses the best move. A good ladder keeps that guess rate low on the early rungs and lets it climb only at "move".

All runs use `npm run eval` over frozen cases from my own games (`evals/cases.json`). Records: `evals/baseline_v0.json`, `evals/redesign_v1.json`, `evals/redesign_v2.json`.

## v0: the original 5-rung ladder (attempt, nudge, hint, move, explain)

18 cases. Every reply passed the hard checks (legal moves, no best move named early, word caps). Leaks were the problem:

| rung | FEN only | attempt | nudge | hint | move |
|---|---|---|---|---|---|
| Haiku guesses a good move | 22% | 50% | 67% | 83% | 100% |

The nudges were technically legal but pointed straight at the answer, e.g. "look at the pawn on f7, what does a capture there force". By the hint rung the move was 83% solved. The validator couldn't catch that: no move name, just a piece and a square.

## The redesign: 6 rungs, and the board does the hinting

attempt → **focus** → **threat** → **piece** → move → explain

- **focus**: the app highlights a coarse zone (3x3 blobs around the good moves' destinations and the opponent's punishing reply) and fades the rest of the board. The coach only writes a question about that area, with no moves, squares or piece names.
- **threat**: the coach draws the opponent's idea as red arrows. Each arrow is checked as a legal opponent move (the turn is flipped and the move generated with chess.js).
- **piece**: the app highlights the piece that has to move. The coach says why it matters, not where it goes.

The engine owns the zone and the piece squares (`src/lib/engine/ideas.ts`), so the LLM can't widen or narrow a hint. The validator gained per-rung rules: for example, focus may not name a piece that a good move uses, and no rung before "move" may mention a good move's destination square.

## v1: leaks down, but too many retries

39 cases (the 18 picks plus every labelled moment).

| rung | FEN only | attempt | focus | threat | piece | move |
|---|---|---|---|---|---|---|
| Haiku guesses a good move | 15% | 23% | 38% | 31% | 49% | 97% |
| needs a retry | | 5% | 77% | 85% | 92% | 10% |
| engine-only fallback | | 0% | 13% | 21% | 31% | 0% |

The leak curve got much flatter. But almost every early reply failed its first try, and up to a third fell back to the plain engine text. The errors had two causes:

1. **Word caps.** The model overshoots any stated cap by 1-8 words (piece replies ran 26-33 words against a cap of 25). It doesn't count tightly.
2. **Made-up threat arrows.** Pawns "capturing" onto empty squares, a bishop moving through a pawn, arrows from empty squares. The prompt already listed the opponent's real captures and checks; the model drew freehand anyway.

## v2: fixing the retries

- The prompt now asks for less than the validator enforces (focus 12 words with a hard cap of 18; threat and piece 20 with a hard cap of 30).
- Threat arrows must be copied from the opponent-threats list. A quiet move is allowed only after checking it's legal right now.
- When an arrow fails, the retry message lists the moves the opponent can actually play from that square, so the second try has something concrete to fix.

| rung | FEN only | attempt | focus | threat | piece | move |
|---|---|---|---|---|---|---|
| Haiku guesses a good move | 21% | 18% | 44% | 38% | 51% | 92% |
| needs a retry | | 10% | 31% | 23% | 5% | 18% |
| engine-only fallback | | 0% | 3% | 3% | 0% | 0% |

On the 18 cases shared with v0, the second rung went from 67% guessable (nudge) to 50% (focus), and the third from 83% (hint) to 50% (threat). That's with one more rung of help before the move.

The judge flagged 41% of explain replies as "padded". That came from our own prompt: it requires a moment-type line, which for multi-idea moments lists several ideas. More ideas are the point ("ideas over best moves"), so the judge now treats that line as required. No-padding at explain went from 59% to 100%.

## Checking the engine heuristics against my labels

I labelled 31 moments on `/label`: my cold guess, the idea, the opponent's motif, the zone, which engine lines share an idea, and the moment type (only-move / many-roads / multi-idea).

- **My cold guess** hits a good move 34% of the time. Haiku from the FEN alone: 15-22%. That's a rough human baseline for the attempt rung.
- **Grouping lines by idea**: 14/22 match my labels at first. The misses were the heuristic merging lines I keep apart. A move-order rule (A's first move appears later in B's line) chained unrelated lines together. Dropping it gave **19/22**. A grid over the other knobs (good-move margin 3-10 win-prob points, single vs complete linkage, same-piece and same-capture rules) did no better.
- **Moment type**: 18/26, and no knob moved it. Most misses are positional moments where I saw one broad idea ("keep central pressure", "push up the board") across lines that move different pieces. A structural rule can't see that. I left it rather than overfit to 26 labels.

## What I'd do next

- Explain-rung judge rerun with full history (the 100% came from an explain-only run).
- Use the labelled zones to score the focus zone (overlap with what I marked).
- Moment type might need the LLM to describe the shared idea, with the engine still deciding which moves are good. Test it against the labels before trusting it.
