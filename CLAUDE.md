# AI chess coach (Chess.com take-home, Option B)

Self-contained web app: a Chess.com username -> recent games -> Stockfish analysis -> an LLM coach walks the player through the 1-3 critical moments of a game with a hint ladder. Spec: `ChessCom_AIML_Internship_Take_Home_Assignment.pdf`. Plan and scope: `PLAN.md`. Sunny's raw ideas: `brainstorm_todo_45min.md`. Post-v0 ideas: `design_decisions/NEXT_STEPS.md` (not a priority in the 4 hours).

## Design rules (don't break these)
- **The engine judges, the LLM explains.** Stockfish computes evals, best lines, centipawn loss. The LLM only sees the engine output + the game and never decides on its own whether a move is good.
- **Validate every move the LLM mentions** with chess.js against the position; the "better move" it names must be in the engine's MultiPV set. Fail -> regenerate once -> engine-only fallback. Never show an unvalidated reply.
- **1-3 critical moments per game**, blunders/mistakes on the user's own moves only. Max 3 points per coach reply.
- **Hint ladder, retrieval first**: attempt -> nudge -> pointed hint -> the move -> explanation. Engine line hidden until the last rung. No motif name before the attempt.
- Feedback on the move, not the person (no "careless", no grades first). Explanation depth scales down with rating.
- LLM output is structured JSON (text, SAN moves, arrows, squares, motif); the board renders it.

## Stack and commands
- Next.js (App Router) + TypeScript, `chess.js`, `react-chessboard`, `stockfish` (single-threaded WASM in a Web Worker, client-side), `@anthropic-ai/sdk`.
- Models: coach `claude-sonnet-5-5` (adaptive thinking, effort medium, `fallbacks: "default"`), eval judge `claude-haiku-5-5`. Engine depth 10, MultiPV 3 at depth 14 on critical positions only. Key in `.env` as `ANTHROPIC_API_KEY` (never committed).
- Run: `npm install && npm run dev`. Type-check: `npx tsc --noEmit`. Eval: `npm run eval` (`scripts/eval.ts` over `evals/cases.json`; run after any prompt change).
- Chess.com API needs no auth; send `User-Agent: ai-chess-coach-takehome` from the server route only. Never put Sunny's email or name in requests.

## Layout (target)
- `app/` pages and `app/api/{games,coach}/route.ts`
- `lib/chesscom.ts` (fetch + PGN parse), `lib/engine/` (worker + analysis + critical moments), `lib/coach/{prompt,schema,validate}.ts`
- `components/` board, game list, moment panel, hint ladder
- `evals/cases.json`, `scripts/eval.ts`
- `transcripts/` agent transcripts copied in at the end (source: `C:\Users\iF3LL\.claude\projects\c--Users-iF3LL-Documents-code-grind-ML-chess-tutor\*.jsonl`; not the `memory/` folder)

## Working here
- Keep v0 small and working before any stretch item. 4-hour budget; see the time table in `PLAN.md`.
- Commit small, self-contained changes without asking once `tsc` passes. Don't commit `.env`.
- Explain new pieces briefly as they land (Sunny is learning while building).
- Reference project for ideas only: `../../ai-tutor-god` (prompt assembly in `web/src/lib/tutor/prompt.ts`, evals in `web/scripts/eval_set.ts`). Don't read its `data/` folder.
