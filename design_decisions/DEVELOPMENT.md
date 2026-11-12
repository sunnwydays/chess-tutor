# How it was built

The order things were built in, what changed along the way and why. The design itself is in [DESIGN.md](DESIGN.md), the ladder's eval numbers per iteration in [EVAL_FINDINGS.md](EVAL_FINDINGS.md).

## 1. Brainstorm and plan

I started from what I know about chess, learning research and my own AI tutor project ([brainstorm_todo_45min.md](brainstorm_todo_45min.md), [brainstorm.jpg](brainstorm.jpg)), then triaged every idea into v0, stretch or cut ([PLAN.md](../PLAN.md)). Three decisions shaped the rest:

- **Option B, and the engine judges.** The spec values grounding in real game data, and an LLM is unreliable at judging chess moves. So Stockfish decides every quality question and the LLM only explains.
- **The bottleneck, not a full annotation.** Only the player's own moves, only 1-3 per game, ranked by win-probability drop.
- **Retrieval first.** The player tries before any hint. Showing the answer is the last rung, not the first.

## 2. v0: the loop end to end

Chess.com fetch and game list, a Stockfish UCI driver (one code path for the browser Worker and Node, so scripts and the app share it), critical-moment detection, and the coach route with prompt, JSON schema, chess.js validation and an engine-only fallback. The ladder had five rungs: attempt, nudge, hint, move, explain.

Choices made here:
- **Engine in the browser** (single-threaded WASM). Nothing to install, no server compute, and no cross-origin-isolation headers. The cost is speed, so depth 10 per ply and the deeper MultiPV search only on critical positions.
- **Win probability, not centipawns**, so swings in already decided games don't outrank close ones.

## 3. Ground truth before tuning

Before changing any prompt, I needed something to measure against. A scan script saves every critical moment from my recent games plus two quiet "control" positions per game, and a `/label` page records, per moment: my cold guess (before seeing the engine), whether I sensed the mistake, the idea, the opponent's motif, the zone, which engine lines share an idea, and the moment type. These 31 labelled moments became the eval cases and the review tab's answer key.

Then the eval harness: deterministic checks per rung (legality, leaks, word caps, retry/fallback rate), a Haiku judge, and a Haiku "leak guess" that tries to find the best move from the hints shown so far.

## 4. The ladder redesign (the main iteration)

The first eval run showed the problem: every reply passed the hard checks, but the nudges pointed straight at the answer. Haiku could guess the move 83% of the time by the hint rung. Text hints like "look at the pawn on f7" give it away without naming a move, and a validator can't catch that.

The fix was to move the hinting onto the board, with code deciding what it shows: **attempt → focus → threat → piece → move → explain**. The engine computes the zone and the piece square; the LLM writes one short question or reason around them. This flattened the leak curve, but up to 92% of early replies then needed a retry, because the model overshoots word caps and draws threat arrows that aren't legal moves. Prompt caps set below the validator's, threat arrows copied from a computed list, and retry messages that name the legal moves brought fallbacks down to 0-3%. Numbers per version: [EVAL_FINDINGS.md](EVAL_FINDINGS.md).

Heuristics went through the same loop against my labels. A move-order rule for grouping engine lines by idea looked sensible but dropped agreement from 19/22 to 14/22, so it was removed. Moment type stayed at 18/26 because no knob helped, and I didn't want to overfit 26 labels.

## 5. Spaced repetition

Planned in [SPACED_REPETITION.md](SPACED_REPETITION.md), built as pure, unit-tested functions first (queue, streams, rubric, session rules), then the `/review` tab. The two review forms reuse the ladder's rule: the LLM extracts or explains, code grades. The idea-answer grader agrees with my hand grades on 30/32 answers.

Rating my control positions "does this look critical?" (engine hidden) showed that the detector finds where I *erred*, not where a position *felt* hard. That's why control streams stay valid as "nothing wrong here" even when they look busy.

## 6. Grounding fixes from real use

Playing through my own games turned up mistakes the evals didn't have cases for:

- The coach called defended pieces "loose". Now the prompt only lists truly undefended pieces as loose, and the validator rejects "hanging/undefended" claims about defended ones.
- Attempts outside the engine's top 3 got "can't rate this". Now the browser evaluates them at depth 12 and the coach gets the eval and the reply line.
- The Qf2 explanation got the tactic's mechanism wrong while the verdict was right. Not fixed yet; the planned fix is in [NEXT_STEPS.md](NEXT_STEPS.md) item 11.

## 7. Deploy, limits and UX

- **Public demo safety.** Rate limits on the Claude routes, plus an engine-only fallback with a notice when the limit is hit, the key is missing or the budget is spent, so the app never breaks in front of a reviewer.
- **Latency.** The next likely rung, and the replies for the good moves, are fetched while the player reads, so most clicks feel instant.
- **UX pass.** A vertical hint stepper, a lead-up replay of the moves before the moment, hover arrows for moves in the text, and the played move hidden until the ladder ends so it doesn't give the moment away. "You" wording only on the viewer's own account. Win-chance drops written as % so they aren't read as eval points.

## 8. Final review pass

A walk through every screen against the docs found rules that disagreed with each other:

- A moment found after several wrong tries counted as "found with no hints". Now only a first-try find with no hints counts as cold.
- Level 2 said "one try" but allowed more. It now locks the board after a miss.
- The review end message looked only at the board, while the queue used the idea or find-the-moment grade. Both now use the same verdict.

## Plan vs what shipped

| Planned for v0 | Shipped |
|---|---|
| 5-rung ladder: attempt, nudge, hint, move, explain | 6 rungs, with the hints drawn on the board by code |
| ~15 frozen eval cases | 39 cases from labelled moments, plus a Haiku judge and leak guess |
| Spaced repetition and control positions as stretch | Built: Leitner queue, two review forms, control streams |
| Candidate moves with reasoning | Still one move per attempt (next steps) |
| Cross-game pattern report | Not built (next steps) |

## How AI was used

Built with Claude Code. Boilerplate and UI pieces went to subagents on cheaper models at medium effort. The prompt, validation and eval work stayed in the main session, and every subagent change was type-checked, tested and committed from the main session. The agent transcripts are in [transcripts/](../transcripts/).
