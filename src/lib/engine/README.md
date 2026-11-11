# Engine

- `types.ts`: `MomentAnalysis`, the shape the coach consumes (evals in cp, user POV).
- `uci.ts`: UCI driver over a transport (`send` / `onLine`). Parses `info ... multipv ... pv` lines into SAN lines in the user POV.
- `analyze.ts`: `analyzeGame()`: depth-10 eval of every ply, user moves with a win-prob drop >= 10 become candidates, top 3 after dedupe within 2 moves, then MultiPV 3 at depth 14 on those positions plus the opponent's best reply (`punish`).
- `node.ts`: transport over the `stockfish` npm package (scripts, evals).
- `browser.ts`: transport over a Web Worker loading `public/stockfish/` (copied by `scripts/copy_engine.mjs` on `predev` / `prebuild`).
