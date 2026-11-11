/**
 * Smoke test for the coach: one hand-built moment (Fried Liver, Black plays 5...Nxd5?)
 * through every rung of the ladder. Prints the reply and any validation errors.
 * Run: npx tsx scripts/smoke_coach.ts [stage ...]
 */
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";
import { generateCoachReply } from "@/lib/coach/client";
import { STAGES, type CoachRequest, type CoachTurn, type Stage } from "@/lib/coach/schema";
import { winProb, type MomentAnalysis } from "@/lib/engine/types";

// Load .env (ANTHROPIC_API_KEY) without a dependency.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5", "Nxf7", "Kxf7", "Qf3+", "Ke6", "Nc3"];
const chess = new Chess();
for (const m of moves.slice(0, 9)) chess.move(m);
const fenBefore = chess.fen();

const line = (move: string, evalCp: number, pv: string[]) => ({ move, evalCp, mate: null, pv });
const moment: MomentAnalysis = {
  ply: 10,
  fenBefore,
  played: "Nxd5",
  evalBefore: -40,
  evalAfter: -260,
  winProbBefore: winProb(-40),
  winProbAfter: winProb(-260),
  lines: [
    line("Na5", -35, ["Na5", "Bb5+", "c6", "dxc6", "bxc6", "Be2", "h6", "Nf3", "e4"]),
    line("Nd4", -70, ["Nd4", "c3", "b5", "Bf1", "Nxd5", "cxd4", "Qxg5"]),
    line("Nxd5", -260, ["Nxd5", "Nxf7", "Kxf7", "Qf3+", "Ke6", "Nc3", "Ncb4", "a3"]),
  ],
  punish: line("Nxf7", -260, ["Nxf7", "Kxf7", "Qf3+", "Ke6", "Nc3", "Ncb4", "a3"]),
};

const base: Omit<CoachRequest, "stage"> = {
  game: {
    white: { username: "opponent", rating: 1450 },
    black: { username: "Sunnwy", rating: 1420 },
    userColor: "black",
    result: "loss",
    timeClass: "rapid",
    opening: "Two Knights Defense",
    moves,
  },
  moment,
  player: { rating: 1420 },
};

async function main() {
  const wanted = (process.argv.slice(2) as Stage[]).filter((s) => STAGES.includes(s));
  const stages: Stage[] = wanted.length ? wanted : [...STAGES];
  const history: CoachTurn[] = [];
  for (const stage of stages) {
    const attempt = stage === "attempt" ? "Nxd5" : undefined;
    const t0 = Date.now();
    const res = await generateCoachReply({ ...base, stage, attempt, history });
    const ms = Date.now() - t0;
    console.log(`\n=== ${stage}${attempt ? ` (tried ${attempt})` : ""}  [${res.source}, ${ms} ms, verdict ${res.attemptVerdict ?? "-"}]`);
    console.log(res.reply.text);
    console.log(`moves=${JSON.stringify(res.reply.moves)} arrows=${JSON.stringify(res.reply.arrows)} squares=${JSON.stringify(res.reply.squares)} motif=${JSON.stringify(res.reply.motif)}`);
    if (res.errors?.length) console.log("errors:", res.errors);
    history.push({ stage, attempt, text: res.reply.text });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
