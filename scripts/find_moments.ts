/**
 * Fetch a user's recent games, run the engine over each, and write every
 * critical moment to evals/moments_<user>.json. The labeling page
 * (/label) reads that file. Run: npx tsx scripts/find_moments.ts [user] [limit]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchRecentGames } from "@/lib/chesscom";
import { parseMoves } from "@/lib/pgn";
import { analyzeGame } from "@/lib/engine/analyze";
import { createNodeEngine } from "@/lib/engine/node";
import type { MomentRecord } from "@/lib/moments";

async function main() {
  const user = process.argv[2] ?? "Sunnwy";
  const limit = Number(process.argv[3] ?? 20);
  const games = await fetchRecentGames(user, limit);
  console.log(`${games.length} games for ${user}`);
  const engine = createNodeEngine();
  const records: MomentRecord[] = [];
  for (const [i, g] of games.entries()) {
    const moves = parseMoves(g.pgn).map((m) => m.san);
    const t0 = Date.now();
    const { moments } = await analyzeGame(engine, moves, g.userColor, { onProgress: (d, n) => process.stderr.write(`
  game ${i + 1}: ${d}/${n}`) });
    const { pgn: _pgn, ...rest } = g;
    void _pgn;
    for (const m of moments) {
      records.push({ id: `${g.id}-${m.ply}`, game: { ...rest, moves }, moment: m });
    }
    process.stderr.write("\n");
    const drops = moments.map((m) => `${m.played}@${m.ply} -${(m.winProbBefore - m.winProbAfter).toFixed(0)}`);
    console.log(`[${i + 1}/${games.length}] ${g.id} ${moves.length} plies ${Date.now() - t0}ms: ${drops.join(", ") || "clean"}`);
  }
  engine.terminate();
  mkdirSync("evals", { recursive: true });
  const out = `evals/moments_${user.toLowerCase()}.json`;
  writeFileSync(out, JSON.stringify(records, null, 1));
  console.log(`${records.length} moments -> ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
