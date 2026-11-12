# Next steps

Rough priority order. Already built since v0 and no longer listed here: the spaced-repetition review tab, control positions, and JSONL logging (see [DESIGN.md](DESIGN.md)).

## Teaching

1. **Good moves too.** Also surface 1-2 moments where the player found the engine's best (or a near-best) move in a sharp position, so they learn what they got right. Most players don't analyse after the game, so a good move they weren't sure about never gets confirmed. Same engine-judges rule: only moves within a small centipawn loss of the top MultiPV line, in positions where the alternatives were clearly worse.
2. **Cross-game pattern report.** A shallow engine pass over the last N games that counts motif tags per critical moment (hanging piece, missed tactic, time trouble from `%clk`, weak opening), then writes one paragraph of study advice grounded in those counts. Moment selection would then follow the player's real bottleneck, not just one game's biggest drop.
3. **Reasoning with the attempt.** First a one-line "why" box next to the move, then full candidate input (2-3 moves, each with a short reason), so the coach can diagnose how the player thinks, not just what they played.
4. **Ideas over best moves.** Raise MultiPV at critical moments and have the coach group the decent moves by plan (pawn storm vs development vs defend first). Progress over perfection: one best move is too narrow a window to learn from.
5. **"Would this attack have worked?"** When the player starts an attack the engine rejects, say why it fails ("the f-pawn defends", "you're a tempo short"). Then let them remove those reasons (take off a defender, give themselves a tempo) and keep coaching the attack from there.
6. **Opening ideas.** When the moment is in the opening, state the opening's long-term plan, not just the local fix.
7. **Opponent analysis.** Patterns in the opponents' play and what they could have done better.

## Visual hints

8. **Coarser and more visual hints.** Circle a region or quarter of the board instead of exact squares, and show the opponent's ideas as arrows before naming any piece, tactic or move. There's likely room for one more rung between "zone" and "piece", since the piece rung still gives away about half the answers.
9. **Stripped-down board.** Optionally fade or hide pieces that don't matter to the idea, so the player sees only the relevant part.
10. **Let the board talk.** Keep the text shorter still and move more of each hint into arrows and highlights.

## Tuning and data

11. **Prompts that handle sacrifices and trade-offs.** Some moves look like they hang material but are deliberate: an aggressive move where a pawn can seemingly just be taken, and the coach doesn't explain why taking it is fine or bad. Other moves are real trade-offs: giving up a rook for faster development, or two pieces under attack where you can only save one, so the right idea is to cover or be ready to recapture when the bishop takes your rook. Right now the coach treats these like plain mistakes. Tune the prompt (and add eval cases) so it names the trade-off, says what you get for what you give, and checks the engine line for why the "free" material isn't free.
12. **A/B test prompts on real use.** Use the JSONL logs to compare prompt versions on time to first attempt, hints taken, success rate, moves stepped through, and signs of frustration from micro-interactions (a statistical model, or a small trained one).
13. **Grow the eval set from real use.** Turn logged interactions (prompt version, rung, attempt, reply, validation result, later verdict) into new frozen cases, from more players and rating bands than mine.
14. **Score the heuristics against more labels.** Measure the focus zone against the zones I labelled, try having the LLM describe the shared idea for moment type (with the engine still picking the good moves), and rerun the explain judge with full history.
15. **Better perturbations.** Perturbed review positions proposed by the LLM and accepted only if the engine confirms the same idea still works, plus level 3 as its own review box.

## Infrastructure

16. **A real backend.** Move moves, analysis cache, review queue and logs out of localStorage into a proper store (self-hosted Postgres or a cloud service), which fits this structured data and allows accounts across devices.
17. **Server-side engine option** for low-end devices, and multi-threaded WASM behind cross-origin-isolation headers.
