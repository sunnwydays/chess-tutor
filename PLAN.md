# Plan: AI chess coach (Chess.com take-home, Option B)

## v0 (the deliverable)

One loop, end to end:

1. Enter a Chess.com username -> fetch recent games (archives API, last ~20 games, newest first) and the player's rating.
2. Pick a game -> Stockfish (WASM, in the browser) evaluates every position -> we compute each of the user's moves' eval swing.
3. The top 1-3 critical moments (largest win-probability drop on the user's own moves, blunders/mistakes only) become the lesson.
4. Per moment: board at the position before the mistake, "What would you play?" The user plays one move on the board.
5. Coach replies through a hint ladder: verdict on the attempt -> nudge -> pointed hint -> the move -> explanation + engine line. Engine line stays hidden until the user reaches that rung.
6. The LLM returns structured JSON (text + SAN moves + arrows + highlighted squares); every SAN is checked with chess.js against the position and against the engine's candidate moves before it is shown.
7. Small eval set (~15 frozen positions) runnable with one command.

Not in v0: cross-game pattern report, spaced repetition, opponent analysis, chat free-for-all. See Stretch.

## Architecture

- **Next.js 15 (App Router) + TypeScript**, `react-chessboard` + `chess.js`.
- **Engine**: `stockfish` npm package (single-threaded WASM build, so no cross-origin-isolation headers), run in a Web Worker. Analysis is client-side: no binary to ship, works with `npm install && npm run dev`. Fixed depth 10 per ply (shallow on purpose: fast, and good enough to find blunders), MultiPV 3 at depth 14 only at the critical positions. Budget ~5-10 s per game with a progress bar.
- **Critical moments**: eval -> win probability (Lichess formula), swing = drop in the user's win probability on their move. Keep swings >= 10 pts, take top 3, dedupe moments within 2 moves of each other. Using win probability (not raw cp) so a -8 to -12 swing in a lost game doesn't outrank a +1 to -2 swing.
- **API routes** (server only, so the key and the User-Agent stay server-side):
  - `GET /api/games?user=` -> proxies chess.com archives (`User-Agent: ai-chess-coach-takehome`), returns slim game list + PGN.
  - `POST /api/coach` -> builds the prompt from {game header, moves so far, FEN, engine output, user's rating, hint stage, user's attempt, this moment's chat so far}, calls Claude with `output_config.format` JSON schema, validates, returns the JSON.
- **Model**: `claude-sonnet-5-5` for the coach (adaptive thinking, effort medium), `claude-haiku-5-5` as the eval judge. Server-side `fallbacks: "default"` on the coach call so a safety-classifier refusal doesn't blank the lesson (can be dropped).
- **Prompt** (`lib/coach/prompt.ts`, same shape as ai-tutor-god): a frozen system prompt (role, teaching rules, output rules, hint-ladder rungs) with `cache_control`, then tagged blocks per request: `<game>`, `<position>`, `<engine>`, `<player>`, `<stage>`, `<attempt>`. The engine block is the only source of truth for move quality; the system prompt says so explicitly.
- **Validation** (`lib/coach/validate.ts`): parse every SAN in `moves`/`arrows` and any SAN-looking token in `text` with chess.js from the FEN; the "better move" the coach names at rungs 3-4 must be one of the engine's MultiPV moves. Fail -> regenerate once with the error fed back -> fall back to a fixed engine-only message.
- **Teaching rules in the system prompt** (from the research list): retrieval first (attempt before any hint), no motif name before the attempt, max 3 points per reply, feedback on the move not the person (no "careless"), explanation depth scales with rating (`<player>` block says the rating band), prefer the long-term idea over "this hangs a pawn" when both are true.
- **Eval** (`scripts/eval.ts`, `evals/cases.json`): frozen {FEN, engine output, stage, attempt, rating} cases; checks: all moves legal, best move agrees with engine, <= 3 points (count of bullets/sentences cap), at rungs 0-2 the best move SAN does not appear, Haiku yes/no judge for "names the idea, not just the move". `npm run eval`. Cases come from Sunny's own games (the brainstorm link game is case #1).

## Brainstorm triage

| Idea | Where |
|---|---|
| Engine judges, LLM explains | v0 core |
| Address the bottleneck: 1-3 moments, blunders/mistakes only, not "great vs best" | v0 core |
| Hint ladder, retrieval first | v0 core |
| Candidate moves + a line of reasoning (anchor the hypothesis) | v0: one move on the board. Reasoning box and multi-candidate input: NEXT_STEPS.md |
| Structured output + eval set | v0 |
| Long-term idea / opening ideas, not just "there was a better move" | v0 via prompt rules + MultiPV 3 so the coach can say "the other decent moves share this idea" |
| Assortment of decent moves grouped by idea | v0 partial (MultiPV 3 at the moment); grouping by plan is stretch |
| Why the move is risky but fine / threat-of-a-fork intent | prompt rule: explain intent, not just what the move does immediately. Not a feature |
| Mix in positions where there is nothing to improve (so "shown = hint" weakens) | stretch (one control position per game) |
| Motif tag per moment -> group across games | v0 tags each moment (hidden until after attempt); the cross-game report is stretch |
| Patterns across last N games (hanging pieces, time trouble, openings) | stretch: shallow pass over N games, clocks from `%clk` |
| Spaced repetition of missed positions | stretch: localStorage queue with a due date |
| Opponent's mistakes and themes | cut for this take-home |
| Expertise reversal (depth scales with rating) | v0 prompt rule |

## Time budget (4 h total; ~1 h spent on brainstorm + plan)

| Block | Time | Done when |
|---|---|---|
| Boilerplate, chess.com fetch, game list, board | 0:30 | pick a game, moves replay on the board |
| Stockfish worker, per-move evals, critical moments | 0:45 | 3 moments listed with cp loss, in a real game |
| Coach route, prompt, JSON schema, validation, hint ladder UI | 1:00 | full ladder on one moment, arrows render |
| Eval set + run | 0:30 | 15 cases, `npm run eval` passes or failures are understood |
| README, design note, time breakdown, transcripts, cleanup | 0:30 | repo is runnable from a clean clone |
| Buffer / first stretch item | 0:45 | |

## Stretch

Not a priority in the 4 hours. Listed in `NEXT_STEPS.md`.

## Agent transcripts

Claude Code writes this session to `C:\Users\iF3LL\.claude\projects\c--Users-iF3LL-Documents-code-grind-ML-chess-tutor\<session-id>.jsonl` (one file per session; the current one is `39655bae-...jsonl`). The `memory/` folder next to it is personal and stays out of the repo. At the end, copy the `.jsonl` files into `transcripts/` in the repo (and a markdown render if there is time).

## Decisions (Nov 11)

- Coach model: Sonnet 5.5. Judge: Haiku 5.5.
- Engine: browser WASM, depth 10 (shallow), MultiPV 3 at depth 14 on the critical positions only.
- Attempt input: one move on the board.
- Test username: `Sunnwy`.
- Git: init now, one commit per feature. Pause after boilerplate for a handoff.
- Boilerplate and simple features run on Sonnet/Opus subagents at medium effort; the prompt, validation and eval work stay with the main model.
