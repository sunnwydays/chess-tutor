/**
 * Game analysis: eval every ply, pick the user's 1-3 worst moves by
 * win-probability drop, then look harder at just those positions.
 */
import { Chess } from "chess.js";
import { MATE_CP, UciEngine, sideToMoveIsUser } from "./uci";
import { winProb, type MomentAnalysis } from "./types";

export interface AnalyzeOptions {
  /** Depth for the pass over every ply. */
  scanDepth?: number;
  /** Depth for MultiPV on critical positions and the punishing reply. */
  deepDepth?: number;
  multipv?: number;
  /** Minimum win-probability drop (points) to count as a critical moment. */
  minDrop?: number;
  maxMoments?: number;
  /** Two moments closer than this many user moves are merged (worst one kept). */
  dedupeMoves?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface PlyEval {
  ply: number;
  san: string;
  fenBefore: string;
  fenAfter: string;
  /** User POV, cp. */
  evalBefore: number;
  evalAfter: number;
  userMove: boolean;
}

export interface GameAnalysis {
  plies: PlyEval[];
  moments: MomentAnalysis[];
}

/** Eval of a terminal position, side-to-move POV (checkmate = the mover lost). */
function terminalEval(chess: Chess): number | null {
  if (chess.isCheckmate()) return -MATE_CP;
  if (chess.isGameOver()) return 0;
  return null;
}

async function evalUserPov(
  engine: UciEngine,
  fen: string,
  depth: number,
  userIsWhite: boolean,
): Promise<number> {
  const sign = sideToMoveIsUser(fen, userIsWhite) ? 1 : -1;
  const term = terminalEval(new Chess(fen));
  if (term !== null) return sign * term;
  const [best] = await engine.search(fen, depth, 1);
  return best ? sign * best.cp : 0;
}

export async function analyzeGame(
  engine: UciEngine,
  moves: string[],
  userColor: "white" | "black",
  opts: AnalyzeOptions = {},
): Promise<GameAnalysis> {
  const scanDepth = opts.scanDepth ?? 10;
  const deepDepth = opts.deepDepth ?? 14;
  const multipv = opts.multipv ?? 3;
  const minDrop = opts.minDrop ?? 10;
  const maxMoments = opts.maxMoments ?? 3;
  const dedupeMoves = opts.dedupeMoves ?? 2;
  const userIsWhite = userColor === "white";

  const chess = new Chess();
  const fens = [chess.fen()];
  for (const m of moves) {
    chess.move(m);
    fens.push(chess.fen());
  }
  const total = fens.length + 2 * maxMoments;
  let done = 0;
  const tick = () => opts.onProgress?.(++done, total);

  const evals: number[] = [];
  for (const fen of fens) {
    evals.push(await evalUserPov(engine, fen, scanDepth, userIsWhite));
    tick();
  }

  const plies: PlyEval[] = moves.map((san, i) => ({
    ply: i + 1,
    san,
    fenBefore: fens[i],
    fenAfter: fens[i + 1],
    evalBefore: evals[i],
    evalAfter: evals[i + 1],
    userMove: (i % 2 === 0) === userIsWhite,
  }));

  const candidates = plies
    .filter((p) => p.userMove)
    .map((p) => ({ p, drop: winProb(p.evalBefore) - winProb(p.evalAfter) }))
    .filter((c) => c.drop >= minDrop)
    .sort((a, b) => b.drop - a.drop);

  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= maxMoments) break;
    if (picked.some((q) => Math.abs(q.p.ply - c.p.ply) < 2 * dedupeMoves)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => a.p.ply - b.p.ply);

  const moments: MomentAnalysis[] = [];
  for (const { p } of picked) {
    const lines = await engine.lines(p.fenBefore, deepDepth, multipv, userIsWhite);
    tick();
    const [punish] = await engine.lines(p.fenAfter, deepDepth, 1, userIsWhite);
    tick();
    // Prefer the deeper evals where the engine produced them.
    const evalBefore = lines[0]?.evalCp ?? p.evalBefore;
    const evalAfter = punish?.evalCp ?? p.evalAfter;
    moments.push({
      ply: p.ply,
      fenBefore: p.fenBefore,
      played: p.san,
      evalBefore,
      evalAfter,
      winProbBefore: winProb(evalBefore),
      winProbAfter: winProb(evalAfter),
      lines,
      punish,
    });
  }
  while (done < total) tick();
  return { plies, moments };
}
