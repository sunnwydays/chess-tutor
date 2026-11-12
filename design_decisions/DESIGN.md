# Design decisions

Why the coach is built the way it is. The one idea behind all of it: **the engine judges, the LLM explains, and code checks everything in between.** How it got here, step by step: [DEVELOPMENT.md](DEVELOPMENT.md).

## Principles

Each feature traces back to a learning-research finding or to a gap I see in the usual post-game review:

| Principle | What it became |
|---|---|
| Retrieval first (Roediger & Karpicke 2006) | The player always plays a move before any hint; the engine line stays hidden until `move`. |
| Spacing (Cepeda et al. 2006) | Moments that needed help come back on a schedule in `/review`. |
| Interleaving (Rohrer & Taylor 2007) | No motif name before the attempt; review mixes in control streams where nothing went wrong. |
| Chunking (Chase & Simon 1973) | Every moment gets a motif tag; review siblings share it. |
| Expertise reversal (Kalyuga 2003) | Explanation depth scales with the rating band. |
| Feedback on the task (Kluger & DeNisi 1996) | Feedback on the move, never the person; no grades first. |
| Low cognitive load | 1-3 moments per game, max 3 points per reply, the board carries most hints. |
| Ideas over best moves | The coach groups the good engine lines by idea and explains the plan, not just "there was a better move". |

## The core loop

1. Enter a Chess.com username. The server fetches the newest ~20 games (last two monthly archives) and the player's rating.
2. Pick a game. Stockfish (WASM, in the browser) evaluates every ply at depth 10.
3. The 1-3 critical moments become the lesson: the player's own moves with the biggest win-probability drop (>= 10 percentage points), deduped within 2 moves, then re-analysed at depth 14 with MultiPV 3 plus the opponent's punishing reply.
4. For each moment the player sees the position before their mistake and plays a move. The coach walks a hint ladder from there.

Why win probability instead of raw centipawns: going from -8 to -12 in a lost game doesn't matter, going from +1 to -2 does. Why only the player's own moves and only 1-3 per game: the goal is the biggest bottleneck, not a full annotation.

Why the engine runs in the browser: nothing to install, no server compute, and the single-threaded build needs no cross-origin-isolation headers. The cost is depth (see limitations).

## Hint ladder (retrieval first)

`attempt -> focus -> threat -> piece -> move -> explain`

| Rung | What the player gets |
|---|---|
| attempt | The engine's verdict on their move, in one sentence |
| focus | A zone of the board is highlighted and the rest fades; a short question about that area |
| threat | Red arrows for what the opponent is threatening |
| piece | The piece that has to move is highlighted, no destination |
| move | The best move and its idea |
| explain | Why it works, what the played move allowed, the line, the motif |

The board does most of the teaching; text hints gave the answer away too easily (see [EVAL_FINDINGS.md](EVAL_FINDINGS.md)). Interaction rules:

- A good or best attempt ends the moment: the remaining rungs hide and the player can ask for the full explanation or look for another good move.
- "Skip to the move" only appears after an attempt and asks for confirmation, since it counts as not found.
- The move actually played stays hidden until the ladder ends, so it can't give the moment away. Repeating a move already tried points at its earlier reply instead of asking again.
- Lessons start with an optional replay of the moves that led to the position.

## Grounding: code over model

Everything that can be computed is computed, so the model only has to put it into words.

- **Move quality** comes from Stockfish. The attempt verdict (best / good / inaccuracy / mistake) is code on win-probability loss ([verdict.ts](../src/lib/coach/verdict.ts)). An attempt outside the top 3 lines is evaluated in the browser at depth 12, and the coach gets its eval and reply line.
- **Hint content** is computed too ([ideas.ts](../src/lib/engine/ideas.ts)): the focus zone (a coarse blob around the good moves' targets and the opponent's reply), the piece squares, which engine lines share an idea, and the moment type (only-move / many-roads / multi-idea). At `focus` and `piece` the server overwrites the model's highlights with these, so the model can't widen or narrow a hint.
- **Board facts** are listed for the model: the opponent's legal captures and checks (each capture marked as defended or not) and the player's undefended pieces. Threat arrows must come from that list, and only listed pieces may be called loose.
- **Structured output.** The model returns JSON (`text`, `moves`, `arrows`, `squares`, `motif`) against a schema ([schema.ts](../src/lib/coach/schema.ts)); the board renders it.
- **Validation before display** ([validate.ts](../src/lib/coach/validate.ts)). Every SAN in the reply, including ones in prose, must be legal or in an engine line. Threat arrows must be moves the opponent could actually play. `move`/`explain` must name an engine candidate. Earlier rungs must not leak a good move, its destination square, or (at `focus`) its piece type, and must not call a defended piece hanging. Plus word caps and a tone check. On failure we regenerate once with the errors fed back (for a bad arrow, the retry lists the legal moves from that square). If that fails too, we show a fixed engine-only reply. An unvalidated reply never reaches the player.

## Context and prompt engineering

The prompt ([prompt.ts](../src/lib/coach/prompt.ts)) is a frozen system prompt (role, rules, what each rung allows) with prompt caching, followed by tagged blocks that change per request:

- `<game>`: players, ratings, time control, opening, result, moves up to the moment
- `<engine>`: FEN, evals and win probability before/after, the top 3 lines tagged with "good" and an idea letter, the opponent's punishing reply, threats and undefended pieces, moment type, zone and piece squares
- `<player>`: rating and band (beginner / club / advanced)
- `<history>`: what the coach already said on this moment, so it builds instead of repeating
- `<attempt>`: the move tried, the engine's verdict on it, and its reply line when it's outside the top 3
- `<stage>`: the current rung, restated with its limits

What's left out matters as much: no raw full-game engine dump, no other moments, nothing the rung isn't allowed to reveal. The prompt says outright that `<engine>` is the only source of truth for move quality. It also asks for fewer words than the validator allows, because the model overshoots any stated cap by a few words.

Models: Sonnet 5.5 as the coach (adaptive thinking, medium effort), Haiku 5.5 for the eval judge and for extracting claims in the review grader.

## Keeping it relevant to the player

- Lessons come only from the player's **own recent games**, and only from **their** moves.
- Rating comes from the game's own time class, so the explanation depth matches how they actually play.
- The app takes any username, so it can't know whose games they are. Ticking "this is my account" switches the wording to "you"; otherwise it says "the player".
- Win-chance drops are written as % so they aren't read as eval points.

## Ground truth: my labels

A scan script ([find_moments.ts](../scripts/find_moments.ts)) runs the engine over my recent games and saves each critical moment plus two quiet "control" positions per game. I labelled these on the `/label` page: my cold guess, whether I sensed the mistake, the idea, the opponent's motif, the zone, and which engine lines share an idea. Those labels are the ground truth for the evals and for review grading.

**Controls vs. "looks critical".** With the engine hidden, I rated 34 control positions "does this look critical?": 16 yes, 18 no. About half the yeses are narrow positions where I played correctly (one or two moves hold: recaptures, forced king moves); the rest are flat or already decided positions that just felt busy. So the detector marks where I *erred*, while I rate how *hard* a position is, and the two differ. A control stays valid as "nothing wrong here" either way, but the 18 "no" positions are the cleaner pick for a position that also feels quiet.

## Spaced repetition

Details in [SPACED_REPETITION.md](SPACED_REPETITION.md).

- A lesson moment you didn't find on the first try without hints goes into a Leitner queue on a virtual clock. The `/review` tab serves it back with less help each time: box 0 the full ladder, box 1 explain the idea in words (Form A), box 2 find the moment in a stream of moves with no eval (Form B). Each session includes one control stream where "nothing wrong" is right.
- After the first rep it serves a sibling (another of your moments with the same motif tag), and failing that the original with colors swapped, so the position can't just be memorized.
- **Form A grading stays in code.** Haiku only extracts claims (ideas, squares, pieces, opponent threats) as JSON, and chess.js drops squares and pieces that aren't on the board. Pure code then scores idea / zone / opponent motif against the label, and a fixed rule gives incorrect / missing details / correct. One follow-up question targets the weakest dimension, built from a template so it can't leak the answer.
- **One verdict per rep.** A Form A or B grade decides the rep when there is one; otherwise the ladder does, and only a first-try find with no hints counts. The message at the end of a rep comes from the same verdict, so it can't disagree with the schedule.
- Every attempt, rung, form answer and finished rep is one JSONL log row (`msToFirstAttempt`, `hintsTaken`, `level`, `positionKind`, `virtualClock`). These are the numbers you'd tune the ladder and the schedule on.

## Latency and cost

- The next likely rung is fetched while the player reads, and when a moment opens, the replies for its good moves are fetched too. Most clicks feel instant, at roughly two Claude calls per rung.
- The system prompt is cached; only the tagged blocks change per call.
- The public demo is rate limited, and when the limit is hit, the key is missing or its budget is spent, the ladder keeps going with engine-only replies and a note saying why.

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
- Idea-explanation rubric (Form A) vs my hand grades: 30/32 (`npm run eval-rubric`).

### How the evals drive prompt work

The evals turn prompt engineering from "read a few replies and guess" into a test loop:

1. Change the prompt, a rung rule or a heuristic.
2. Run `npm run eval`. You can rerun just the failing cases or rungs with `--cases` / `--stages`.
3. Compare with a saved run (`evals/baseline_v0.json` is the first full run). Keep the change if more checks pass and nothing regresses; otherwise revert it.

The failures tell you what to fix. A leak check names the exact square or move that leaked, the judge's note says why a reply missed the idea, and a high retry or fallback rate on one rung means that rung's instructions are unclear. The full history of runs is in [EVAL_FINDINGS.md](EVAL_FINDINGS.md).

## Current limitations

- **Shallow engine.** Depth 10 per ply and MultiPV 3 at depth 14 on critical positions keep analysis fast in the browser, but deep tactics can be missed and only 3 candidate lines exist. An attempt outside those 3 gets an "unknown" verdict if its depth-12 check takes over 4 s.
- **Single-threaded WASM.** It's slow on low-end devices, and every game is analysed on the client.
- **Moment selection is "where I erred", not "what I should study".** It's purely the win-probability drop on one move, so it ignores time trouble, repeated patterns across games, and how hard the position felt.
- **The piece rung still gives a lot away.** Haiku guesses the move about half the time once the piece is highlighted.
- **Explanations can get the mechanism wrong** while the verdict is right (the Qf2 example in [NEXT_STEPS.md](NEXT_STEPS.md)), because the coach retells the engine line instead of having it annotated move by move.
- **Heuristics with known misses.** Moment type matches my labels 18/26: positional moments with one broad idea across different pieces look like "multi-idea" to the structural rule.
- **A small, one-player eval set.** 39 cases and 31 labelled moments, all from my games at one rating band. The Haiku judge is only checked against hand grades for the Form A rubric.
- **Prose validation is regex-based.** It catches SAN and square names, but not descriptive phrasing like "the knight jumps into the king's side".
- **One move per attempt, no reasoning.** The coach sees what was played, not why, and there's no free chat.
- **Demo limits.** 150 Claude calls per IP per 10 min and 2000 a day (tunable through env vars). The counters live in memory, so on Vercel each server instance counts separately. That's fine for a demo but would need a shared store like Redis in production.
- **Local-only state.** The analysis cache, review queue and logs live in localStorage and a local JSONL file (function logs on Vercel), so they're per browser. Review runs on a virtual clock for the demo, and color swap is the only perturbation.

## Next

See [NEXT_STEPS.md](NEXT_STEPS.md).
