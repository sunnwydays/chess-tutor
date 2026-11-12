# Next steps

Rough priority order. Already built since v0 and no longer listed here: the spaced-repetition review tab, control positions, and JSONL logging (see [DESIGN.md](DESIGN.md)).

## Teaching

1. **Cross-game pattern report.** A shallow engine pass over the last N games that counts motif tags per critical moment (hanging piece, missed tactic, time trouble from `%clk`, weak opening), then writes one paragraph of study advice grounded in those counts. Moment selection would then follow the player's real bottleneck, not just one game's biggest drop.
2. **Reasoning with the attempt.** First a one-line "why" box next to the move, then full candidate input (2-3 moves, each with a short reason), so the coach can diagnose how the player thinks, not just what they played.
3. **Ideas over best moves.** Raise MultiPV at critical moments and have the coach group the decent moves by plan (pawn storm vs development vs defend first). Progress over perfection: one best move is too narrow a window to learn from.
4. **"Would this attack have worked?"** When the player starts an attack the engine rejects, say why it fails ("the f-pawn defends", "you're a tempo short"). Then let them remove those reasons (take off a defender, give themselves a tempo) and keep coaching the attack from there.
5. **Opening ideas.** When the moment is in the opening, state the opening's long-term plan, not just the local fix.
6. **Opponent analysis.** Patterns in the opponents' play and what they could have done better.

## Visual hints

7. **Coarser and more visual hints.** Circle a region or quarter of the board instead of exact squares, and show the opponent's ideas as arrows before naming any piece, tactic or move. There's likely room for one more rung between "zone" and "piece", since the piece rung still gives away about half the answers.
8. **Stripped-down board.** Optionally fade or hide pieces that don't matter to the idea, so the player sees only the relevant part.
9. **Let the board talk.** Keep the text shorter still and move more of each hint into arrows and highlights.

## Tuning and data

10. **A/B test prompts on real use.** Use the JSONL logs to compare prompt versions on time to first attempt, hints taken, success rate, moves stepped through, and signs of frustration from micro-interactions (a statistical model, or a small trained one).
11. **Grow the eval set from real use.** Turn logged interactions (prompt version, rung, attempt, reply, validation result, later verdict) into new frozen cases, from more players and rating bands than mine.
12. **Score the heuristics against more labels.** Measure the focus zone against the zones I labelled, try having the LLM describe the shared idea for moment type (with the engine still picking the good moves), and rerun the explain judge with full history.
13. **Better perturbations.** Perturbed review positions proposed by the LLM and accepted only if the engine confirms the same idea still works, plus level 3 as its own review box.

## Infrastructure

14. **A real backend.** Move moves, analysis cache, review queue and logs out of localStorage into a proper store (self-hosted Postgres or a cloud service), which fits this structured data and allows accounts across devices.
15. **Server-side engine option** for low-end devices, and multi-threaded WASM behind cross-origin-isolation headers.
