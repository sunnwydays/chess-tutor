# Design decisions

A short tour of why the coach is built the way it is. The one idea behind all of it: **the engine judges, the LLM explains, and code checks everything in between.**

## The core loop

1. Enter a Chess.com username. The server fetches the newest ~20 games (last two monthly archives) and the player's rating.
2. Pick a game. Stockfish (WASM, in the browser) evaluates every ply at depth 10.
3. The 1-3 critical moments become the lesson: the player's own moves with the biggest win-probability drop (>= 10 points), deduped within 2 moves, then re-analysed at depth 14 with MultiPV 3 plus the opponent's punishing reply.
4. For each moment the player sees the position before their mistake and plays a move. The coach walks a hint ladder from there.

Why win probability instead of raw centipawns: going from -8 to -12 in a lost game doesn't matter, going from +1 to -2 does. Why only the player's own moves and only 1-3 per game: the goal is the biggest bottleneck, not a full annotation, and a short list keeps cognitive load low.

## Hint ladder (retrieval first)

`attempt -> focus -> threat -> piece -> move -> explain`

The player always tries first; the answer only shows up at `move`. Each rung gives a bit more:

| Rung | What the player gets |
|---|---|
| attempt | The engine's verdict on their move, in one sentence |
| focus | A zone of the board is highlighted and the rest fades; a 15-word question about that area |
| threat | Red arrows for what the opponent is threatening |
| piece | The piece that has to move is highlighted, no destination |
| move | The best move and its idea |
| explain | Why it works, what the played move allowed, the line, the motif |

The board does most of the teaching; the text stays short (word caps per rung, max 3 bullets). No motif name before the attempt, feedback on the move and never the person, and explanation depth scales with the rating band.

## Grounding: code over model

Everything that can be computed is computed, so the model only has to put it into words.

- **Move quality** comes from Stockfish. The attempt verdict (best / good / inaccuracy / mistake) is code on win-probability loss ([verdict.ts](../src/lib/coach/verdict.ts)), not the model's opinion.
- **Hint content** is computed too ([ideas.ts](../src/lib/engine/ideas.ts)): the focus zone (a coarse blob around the good moves' targets and the opponent's reply), the piece squares, which engine lines share an idea, and the moment type (only-move / many-roads / multi-idea). At `focus` and `piece` the server overwrites the model's highlights with these, so the model can't widen or narrow a hint.
- **Structured output.** The model returns JSON (`text`, `moves`, `arrows`, `squares`, `motif`) against a schema ([schema.ts](../src/lib/coach/schema.ts)); the board renders it.
- **Validation before display** ([validate.ts](../src/lib/coach/validate.ts)). Every SAN in the reply, including ones in prose, must be legal or in an engine line; threat arrows must be moves the opponent could actually play; `move`/`explain` must name an engine candidate; earlier rungs must not leak a good move, its destination square, or (at `focus`) its piece type; plus word caps and a tone check. On failure we regenerate once with the errors fed back, and if that fails too we show a fixed engine-only reply. An unvalidated reply never reaches the player.

## Context and prompt engineering

The prompt ([prompt.ts](../src/lib/coach/prompt.ts)) is a frozen system prompt (role, rules, what each rung allows) with prompt caching, followed by tagged blocks that change per request:

- `<game>`: players, ratings, time control, opening, result, moves up to the moment
- `<engine>`: FEN, evals and win probability before/after, the top 3 lines tagged with "good" and an idea letter, the opponent's punishing reply, moment type, zone and piece squares
- `<player>`: rating and band (beginner / club / advanced)
- `<history>`: what the coach already said on this moment, so it builds instead of repeating
- `<attempt>`: the move tried and the engine's verdict on it
- `<stage>`: the current rung, restated with its limits

What's left out matters as much: no raw full-game engine dump, no other moments, nothing the rung isn't allowed to reveal. The prompt says outright that `<engine>` is the only source of truth for move quality.

Models: Sonnet 5.5 as the coach (adaptive thinking, medium effort), Haiku 5.5 as the eval judge.

## Keeping it relevant to the player

- Lessons come only from the player's **own recent games**, and only from **their** moves.
- Rating comes from the game's own time class, so the explanation depth matches how they actually play.
- A scan script ([find_moments.ts](../scripts/find_moments.ts)) runs the engine over the recent games and saves each critical moment plus two quiet "control" positions per game. I labelled these on a `/label` page: my cold guess, whether I sensed the mistake, the idea, the opponent's motif, the zone, and which engine lines share an idea. Those labels are the ground truth for the evals below.
- **Controls vs. "looks critical".** With the engine hidden, I rated 34 control positions "does this look critical?": 16 yes, 18 no. About half the yeses are narrow positions where I played correctly (one or two moves hold: recaptures, forced king moves); the rest are flat or already decided positions that just felt busy. The "no" set is mostly flat. So the detector marks where I *erred*, while I rate how *hard* a position is, and the two differ. A control stays valid as "nothing wrong here" either way, but the 18 "no" positions are the cleaner pick when I want a position that also feels quiet.
- Spaced repetition ([SPACED_REPETITION.md](SPACED_REPETITION.md)): a lesson moment that needed hints goes into a Leitner queue on a virtual clock, and the `/review` tab serves it back with less help each time. Box 0 gets the full ladder (with the moves that led to it the first time). Box 1 asks you to explain the idea in words (Form A). Box 2 asks you to find the moment in a stream of moves with no eval (Form B). Each session includes one control stream where "nothing wrong" is the right answer. After the first rep it serves a sibling, meaning another of your moments with the same motif tag, read from the labels by the rubric's motif vocabulary. Failing that it serves the original with colors swapped, so the position can't just be memorized.
- **Form A grading stays in code.** Haiku only extracts claims (ideas, squares, pieces, opponent threats) as JSON, and chess.js drops squares and pieces that aren't on the board. Pure code then scores idea / zone / opponent motif against the label, and a fixed rule gives incorrect / missing details / correct. You get one follow-up question aimed at the weakest dimension, built from a template so it can't leak the answer.
- Every attempt, rung, form answer and finished rep is one JSONL log row (`msToFirstAttempt`, `hintsTaken`, `level`, `positionKind`, `virtualClock`). These are the numbers you'd tune the ladder and the schedule on.

## Evals

`npm run eval` runs frozen cases from my own games through every rung:

- 39 cases frozen from labelled moments.
- Per rung, deterministic: legality, leak checks, word caps, and how often the first try passes, a retry is needed, or we fall back.
- **Haiku judge** (rubric grader). For each reply it sees the position, the player's rating, the played move, the engine's best line and candidates, my label for the idea and the opponent's motif, and the rule for that rung. It returns four yes/no grades as JSON:
  - *names the idea*: gets across the plan, threat or motif, not just a move or an eval (on early rungs it points toward the idea without giving the move)
  - *giveaway*: on rungs before `move`, it gives away a good move by name, by piece plus square, or with an arrow
  - *depth fits rating*: plain words under 1000, tactic named and a short line up to 1600, vocabulary and the long-term idea above that
  - *forced style*: judges the person, opens with praise or filler, or pads past 3 points

  The judge only scores replies for the eval report. It never decides move quality and never runs in the app.
- **Leak guess**: Haiku sees the FEN, the legal moves and every hint shown so far, and guesses the best move. We compare its hit rate on each rung with a FEN-only baseline. The hit rate should go up slowly as the rungs go on and only reach the answer at `move`.
- Idea grouping heuristic vs my labels: 19/22 (a move-order rule was tried and dropped; it scored 14/22).
- Idea-explanation rubric (the spaced-repetition grading form) vs my hand grades: 31/32.

### How the evals drive prompt work

The evals turn prompt engineering from "read a few replies and guess" into a test loop. The cases are frozen and say what we expect (legal moves, no leaks before `move`, the engine's move named after it, the right depth), so any prompt change can be measured:

1. Change the prompt, a rung rule or a heuristic.
2. Run `npm run eval`. You can rerun just the failing cases or rungs with `--cases` / `--stages`.
3. Compare with the saved run (`evals/baseline_v0.json` is the first full run). Keep the change if more checks pass and nothing regresses; otherwise revert it.

The failures tell you what to fix. A leak check names the exact square or move that leaked, the judge's note says why a reply missed the idea, and a high retry or fallback rate on one rung means that rung's instructions are unclear. The idea-grouping rule went through the same loop: a move-order rule looked sensible, but it lowered agreement with my labels from 19/22 to 14/22, so it was dropped.

## Not in scope (yet)

See [NEXT_STEPS.md](NEXT_STEPS.md): cross-game pattern report, level 3 as its own box, LLM-proposed perturbations checked by the engine, a "why" box next to the attempt, opponent analysis, logging real use as new eval cases.
