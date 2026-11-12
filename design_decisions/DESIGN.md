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
- Spaced repetition is built as logic but not wired into the UI yet ([SPACED_REPETITION.md](SPACED_REPETITION.md)): missed moments come back on a Leitner schedule with less help each time, using a different moment from the player's own games with the same idea so it can't just be memorized.

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

## Not in scope (yet)

See [NEXT_STEPS.md](NEXT_STEPS.md): cross-game pattern report, spaced repetition in the UI, a "why" box next to the attempt, opponent analysis, logging real use as new eval cases.
