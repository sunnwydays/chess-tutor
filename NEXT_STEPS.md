# Next steps (after the 4-hour v0)

In rough priority order. None of these are part of v0.

1. **Cross-game pattern report**: shallow engine pass over the last N games, count motif tags per critical moment (hanging piece, missed tactic, time trouble from `%clk`, weak opening), one paragraph of study advice grounded in those counts. This is the "process before the concrete mistake" layer.
2. **Spaced repetition**: missed moments go into a queue (localStorage or a tiny JSON store) with a due date (1 d, 3 d, 7 d); a "Review" tab serves due positions without the game context.
3. **Reasoning with the attempt**: a one-line "why" box next to the move, then full candidate-list input (2-3 moves, each with a short reason) so the coach can diagnose how the player thinks, not just what they played.
4. **Control positions**: mix one "nothing to improve" position per game into the lesson so "a position is shown" stops being a hint in itself.
5. **Decent moves grouped by idea**: at a critical moment, show the engine's top 3 and have the coach group them by plan (pawn storm, development, defend first) instead of only naming the best one.
6. **Opening ideas**: when the moment is in the opening, the coach states the opening's long-term plan, not just the local fix.
7. **Opponent analysis**: patterns in the opponents' play and what they could have done better (cut from v0).
8. **Logging as data**: one JSONL row per coach interaction (prompt version, stage, attempt, reply, validation result, later verdict) so new eval cases come from real use.
9. **Server-side engine option** for lower-end devices, and multi-threaded WASM behind cross-origin-isolation headers.
