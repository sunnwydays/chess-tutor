/**
 * Fetch a user's recent games, run the engine over each, and write every
 * critical moment plus two control positions per game to
 * evals/moments_<user>.json. The labeling page (/label) and the review
 * stream builder (src/lib/review/streams.ts) read that file.
 * Run: npx tsx scripts/find_moments.ts [user] [limit] [--fresh]
 *
 * Reruns keep the critical records already in the output file for games it
 * has seen (the engine is not bit-for-bit repeatable and labels match by
 * id); --fresh re-derives everything.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchRecentGames } from "@/lib/chesscom";
import { parseMoves } from "@/lib/pgn";
import { analyzeGame, type PlyEval } from "@/lib/engine/analyze";
import { createNodeEngine } from "@/lib/engine/node";
import type { UciEngine } from "@/lib/engine/uci";
import { winProb, type MomentAnalysis } from "@/lib/engine/types";
import type { MomentRecord } from "@/lib/moments";

/** Control = user's move within this many win-% of best... */
const CONTROL_MAX_DROP = 5;
/** ...and the eval moved less than this across each of the 2 plies before. */
const CONTROL_MAX_SWING = 5;
const CONTROLS_PER_GAME = 2;
/** Skip the opening: controls there are too easy and look alike. */
const CONTROL_MIN_PLY = 12;
/** Keep controls this many plies clear of any critical moment. */
const CONTROL_CLEAR = 4;
const DEEP_DEPTH = 14;

/** Two quiet user moves per game, spread across the game, away from the critical ones. */
function pickControls(plies: PlyEval[], criticalPlies: number[]): PlyEval[] {
  const ok = plies.filter((p, i) => {
    if (!p.userMove || p.ply < CONTROL_MIN_PLY) return false;
    if (winProb(p.evalBefore) - winProb(p.evalAfter) > CONTROL_MAX_DROP) return false;
    if (criticalPlies.some((c) => Math.abs(c - p.ply) <= CONTROL_CLEAR)) return false;
    for (let k = 1; k <= 2; k++) {
      const q = plies[i - k];
      if (!q || Math.abs(winProb(q.evalAfter) - winProb(q.evalBefore)) > CONTROL_MAX_SWING) return false;
    }
    return true;
  });
  if (ok.length <= CONTROLS_PER_GAME) return ok;
  // Evenly spaced picks (1/3 and 2/3 of the way through) so they don't cluster.
  const picks: PlyEval[] = [];
  for (let k = 1; k <= CONTROLS_PER_GAME; k++) {
    picks.push(ok[Math.floor((ok.length * k) / (CONTROLS_PER_GAME + 1))]);
  }
  return picks;
}

async function controlMoment(engine: UciEngine, p: PlyEval, userIsWhite: boolean): Promise<MomentAnalysis> {
  const lines = await engine.lines(p.fenBefore, DEEP_DEPTH, 3, userIsWhite);
  // Scan-depth evals on both sides, so "within 5 win-% of best" holds as stated.
  return {
    ply: p.ply,
    fenBefore: p.fenBefore,
    played: p.san,
    evalBefore: p.evalBefore,
    evalAfter: p.evalAfter,
    winProbBefore: winProb(p.evalBefore),
    winProbAfter: winProb(p.evalAfter),
    lines,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const fresh = process.argv.includes("--fresh");
  const user = args[0] ?? "Sunnwy";
  const limit = Number(args[1] ?? 20);
  const out = `evals/moments_${user.toLowerCase()}.json`;
  const previous: MomentRecord[] = !fresh && existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as MomentRecord[]) : [];
  const games = await fetchRecentGames(user, limit);
  console.log(`${games.length} games for ${user}${previous.length ? `, keeping criticals from ${out}` : ""}`);
  const engine = createNodeEngine();
  const records: MomentRecord[] = [];
  for (const [i, g] of games.entries()) {
    const moves = parseMoves(g.pgn).map((m) => m.san);
    const t0 = Date.now();
    const { plies, moments } = await analyzeGame(engine, moves, g.userColor, {
      onProgress: (d, n) => process.stderr.write(`\r  game ${i + 1}: ${d}/${n}`),
    });
    const { pgn: _pgn, ...rest } = g;
    void _pgn;
    const kept = previous.filter((r) => r.game.id === g.id && (r.kind ?? "critical") === "critical");
    const useMoments = kept.length ? kept.map((r) => r.moment) : moments;
    const criticalPlies = useMoments.map((m) => m.ply);
    const winProbs = [winProb(plies[0]?.evalBefore ?? 0), ...plies.map((p) => winProb(p.evalAfter))].map(
      (w) => Math.round(w * 10) / 10,
    );
    const game = { ...rest, moves, winProbs, criticalPlies };
    for (const m of useMoments) {
      records.push({ id: `${g.id}-${m.ply}`, kind: "critical", game, moment: m });
    }
    const controls = pickControls(plies, criticalPlies);
    for (const p of controls) {
      const m = await controlMoment(engine, p, g.userColor === "white");
      records.push({ id: `${g.id}-${m.ply}`, kind: "control", game, moment: m });
    }
    process.stderr.write("\n");
    const drops = useMoments.map((m) => `${m.played}@${m.ply} -${(m.winProbBefore - m.winProbAfter).toFixed(0)}`);
    const ctrl = controls.map((p) => `${p.san}@${p.ply}`);
    console.log(
      `[${i + 1}/${games.length}] ${g.id} ${moves.length} plies ${Date.now() - t0}ms: ${drops.join(", ") || "clean"}${kept.length ? " (kept)" : ""} | controls ${ctrl.join(", ") || "none"}`,
    );
  }
  engine.terminate();
  mkdirSync("evals", { recursive: true });
  writeFileSync(out, JSON.stringify(records, null, 1));
  const nCrit = records.filter((r) => r.kind === "critical").length;
  console.log(`${nCrit} critical + ${records.length - nCrit} control -> ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
