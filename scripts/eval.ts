/**
 * Eval harness over evals/cases.json. Runs the coach through every rung of the
 * ladder on each case and reports:
 *   1. pure-function checks (attempt verdict, idea grouping / moment type vs labels)
 *   2. deterministic leak checks per case x rung, plus try-1 / try-2 / fallback rates
 *   3. leak-guess: Haiku guesses the best move from what the player has seen so far
 *      (rung 0 = FEN only), and the human guess rate from the labels
 *   4. Haiku judge: names the idea, not a giveaway, depth fits rating, no forced style
 *
 * Run: npm run eval -- [--limit N] [--cases id,id] [--stages a,b] [--no-llm] [--no-judge]
 *                      [--no-leak] [--concurrency N] [--out evals/last_run.json]
 * Writes a JSON report (default evals/last_run.json) and prints a summary.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { Chess } from "chess.js";
import { generateCoachReply } from "@/lib/coach/client";
import type { EvalCase } from "@/lib/coach/evalcase";
import { STAGES, type CoachReply, type CoachRequest, type CoachTurn, type Stage } from "@/lib/coach/schema";
import { CAPS, HIDDEN_STAGES, legalSans, mentions, sanTokens } from "@/lib/coach/validate";
import { goodCandidates, judgeAttempt, normSan } from "@/lib/coach/verdict";
import type { MomentAnalysis } from "@/lib/engine/types";
import { checkIdeas } from "./eval_ideas";

// Load .env (ANTHROPIC_API_KEY) without a dependency.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const JUDGE_MODEL = "claude-haiku-5-5";

// ---------- args ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

const opts = {
  limit: Number(arg("--limit") ?? Infinity),
  cases: arg("--cases")?.split(","),
  stages: (arg("--stages")?.split(",") as Stage[] | undefined) ?? [...STAGES],
  llm: !flag("--no-llm"),
  judge: !flag("--no-judge"),
  leak: !flag("--no-leak"),
  concurrency: Number(arg("--concurrency") ?? 4),
  out: arg("--out") ?? "evals/last_run.json",
};

// ---------- deterministic checks ----------

/** Rungs before the move is revealed. */
const EARLY: Stage[] = HIDDEN_STAGES;
/** Word caps per rung, same as the validator. */
const WORD_CAP = (s: Stage) => CAPS[s].words;
const MAX_BULLETS = 3;
const PERSON_RE = /\b(careless|sloppy|lazy|obvious(ly)?|silly|you (missed|should have|overlooked|forgot)|basic mistake|beginner('s)? mistake)\b/i;
const PIECE_RE = /\b(king|queen|rook|bishop|knight|pawn)\b[^.;\n]{0,40}?\b([a-h][1-8])\b/gi;
const PIECE_LETTER: Record<string, string> = { king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p" };

export interface LeakResult {
  illegalMoves: string[];
  /** Hidden candidate named in text / listed in moves / drawn as an arrow (early rungs). */
  giveaway: string[];
  /** "<piece> ... <square>" where the square is the destination of a hidden candidate and the piece matches. */
  pieceSquare: string[];
  bullets: number;
  words: number;
  overWordCap: boolean;
  personWords: string[];
  /** Late rungs: no engine candidate named. */
  noCandidateNamed: boolean;
  pass: boolean;
}

function hiddenMoves(moment: MomentAnalysis, stage: Stage, attempt?: string): string[] {
  let hidden = goodCandidates(moment);
  if (stage === "attempt" && attempt) {
    const j = judgeAttempt(moment, attempt);
    if (j.verdict === "best" || j.verdict === "good") hidden = hidden.filter((h) => h !== normSan(attempt));
  }
  return hidden;
}

export function leakCheck(reply: CoachReply, req: CoachRequest): LeakResult {
  const m = req.moment;
  const chess = new Chess(m.fenBefore);
  const known = legalSans(m.fenBefore);
  for (const l of m.lines) for (const s of l.pv) known.add(normSan(s));
  if (m.punish) for (const s of m.punish.pv) known.add(normSan(s));
  for (const s of req.game.moves) known.add(normSan(s));

  const illegalMoves = [
    ...reply.moves.filter((x) => !known.has(normSan(x))),
    ...sanTokens(reply.text).filter((t) => !known.has(t)),
  ];

  const giveaway: string[] = [];
  const pieceSquare: string[] = [];
  if (EARLY.includes(req.stage)) {
    for (const h of hiddenMoves(m, req.stage, req.attempt)) {
      if (mentions(reply.text, h)) giveaway.push(`text:${h}`);
      if (reply.moves.some((x) => normSan(x) === h)) giveaway.push(`moves:${h}`);
      let mv: ReturnType<Chess["move"]> | null = null;
      try {
        mv = chess.move(h);
        chess.undo();
      } catch {}
      if (!mv) continue;
      if (reply.arrows.some((a) => a.from === mv.from && a.to === mv.to)) giveaway.push(`arrow:${h}`);
      for (const pm of reply.text.matchAll(PIECE_RE)) {
        if (pm[2] === mv.to && PIECE_LETTER[pm[1].toLowerCase()] === mv.piece) pieceSquare.push(`${pm[1]}->${pm[2]} (${h})`);
      }
    }
  }

  const bullets = reply.text.split("\n").filter((l) => /^\s*(-|\*|\d+[.)])\s+/.test(l)).length;
  const words = reply.text.trim().split(/\s+/).filter(Boolean).length;
  const personWords = Array.from(reply.text.matchAll(new RegExp(PERSON_RE.source, "gi")), (x) => x[0]);
  const late = req.stage === "move" || req.stage === "explain";
  const noCandidateNamed = late && !m.lines.some((l) => mentions(reply.text, l.move));
  const overWordCap = words > WORD_CAP(req.stage);
  // pieceSquare is informational at "piece" (the rung highlights the piece; the square should still be hidden).
  const pieceSquareFails = req.stage !== "piece" && pieceSquare.length > 0;
  const pass =
    illegalMoves.length === 0 &&
    giveaway.length === 0 &&
    !pieceSquareFails &&
    bullets <= MAX_BULLETS &&
    !overWordCap &&
    personWords.length === 0 &&
    !noCandidateNamed;
  return { illegalMoves, giveaway, pieceSquare, bullets, words, overWordCap, personWords, noCandidateNamed, pass };
}

// ---------- Haiku: leak guess and judge ----------

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

function parseJson<T>(text: string, stopReason: string | null): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    process.stderr.write(`bad judge JSON (stop_reason ${stopReason}): ${text.slice(0, 80)}
`);
    return null;
  }
}

const GUESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["move", "reason"],
  properties: { move: { type: "string" }, reason: { type: "string" } },
} as const;

/** What the player has seen so far on this moment, in the order it was shown. */
interface Shown {
  stage: Stage;
  text: string;
  arrows: string[];
  squares: string[];
  motif?: string;
}

async function guessMove(fen: string, shown: Shown[]): Promise<string> {
  const chess = new Chess(fen);
  const legal = chess.moves();
  const side = chess.turn() === "w" ? "White" : "Black";
  const seen = shown.length
    ? "\n\nHints the player has seen so far (in order):\n" +
      shown
        .map(
          (s) =>
            `[${s.stage}] ${s.text}` +
            (s.arrows.length ? `\n  arrows: ${s.arrows.join(", ")}` : "") +
            (s.squares.length ? `\n  highlighted squares: ${s.squares.join(", ")}` : "") +
            (s.motif ? `\n  motif: ${s.motif}` : ""),
        )
        .join("\n")
    : "";
  const res = await client().messages.create({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    output_config: { effort: "low", format: { type: "json_schema", schema: GUESS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Position (FEN): ${fen}\n${side} to move. Legal moves: ${legal.join(" ")}${seen}\n\nGuess the best move. Answer with one SAN move from the legal list.`,
      },
    ],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  return normSan(parseJson<{ move: string }>(text, res.stop_reason)?.move ?? "");
}

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["namesIdea", "giveaway", "depthFitsRating", "forcedStyle", "note"],
  properties: {
    namesIdea: { type: "boolean" },
    giveaway: { type: "boolean" },
    depthFitsRating: { type: "boolean" },
    forcedStyle: { type: "boolean" },
    note: { type: "string" },
  },
} as const;

export interface JudgeResult {
  namesIdea: boolean;
  giveaway: boolean;
  depthFitsRating: boolean;
  forcedStyle: boolean;
  note: string;
}

async function judgeReply(c: EvalCase, stage: Stage, reply: CoachReply): Promise<JudgeResult> {
  const m = c.moment;
  const best = m.lines[0];
  const rungRule: Record<Stage, string> = {
    attempt: "react to the player's attempt; must not name the best move, a near-best candidate or the motif",
    focus: "one short pointer to the area of the board that matters (the board highlights the zone and fades the rest); no move names, no piece names of the answer, no destination squares",
    threat: "what the opponent threatens, drawn as red arrows; must not reveal the player's best move",
    piece: "which of the player's pieces should move (its square is highlighted); must not reveal where it goes",
    move: "name the best move and the idea behind it",
    explain: "the full picture: why the best move works, what the played move allowed, the line, the motif, and a required moment-type line (many-roads: the shared idea; multi-idea: each idea in a few words)",
  };
  const prompt = `You are grading one reply from a chess coach. The coach walks a player through a critical moment with a hint ladder (attempt -> focus -> threat -> piece -> move -> explain).

Position (FEN): ${m.fenBefore}
Player rating: ${c.player.rating}
Player played: ${m.played} (it lost ${(m.winProbBefore - m.winProbAfter).toFixed(0)} win-probability points)
Engine best: ${best.move}, line ${best.pv.join(" ")}
Other engine candidates: ${m.lines.slice(1).map((l) => l.move).join(", ") || "none"}
${c.label?.idea ? `Human label for the idea: ${c.label.idea}\n` : ""}${c.label?.opponentMotif ? `Human label for the opponent's motif: ${c.label.opponentMotif}\n` : ""}
This reply is the "${stage}" rung: ${rungRule[stage]}.

Coach reply:
${reply.text}
arrows: ${JSON.stringify(reply.arrows)} squares: ${JSON.stringify(reply.squares)} motif: ${JSON.stringify(reply.motif)}

Grade:
- namesIdea: does the reply convey the idea of the position (the plan, threat or motif), not just a move or an eval? At the early rungs, "names the idea" means it points toward the idea without revealing the move.
- giveaway: at attempt/focus/threat/piece, does it reveal the best move or a near-best candidate (by name, by piece plus destination square, or by an arrow)? At move/explain always false.
- depthFitsRating: under 1000 = plain words, one concrete idea, no jargon; 1000-1600 = tactic named, short line; above 1600 = vocabulary and the long-term idea. Is the depth right for ${c.player.rating}?
- forcedStyle: does it grade the person ("careless", "obvious", "you missed"), open with praise or filler, or pad with more than 3 points? At explain the moment-type line listing the ideas is required: it is not padding.
- note: one sentence.`;
  const res = await client().messages.create({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  return (
    parseJson<JudgeResult>(text, res.stop_reason) ?? {
      namesIdea: false,
      giveaway: false,
      depthFitsRating: false,
      forcedStyle: false,
      note: `judge output unparseable (stop_reason ${res.stop_reason})`,
    }
  );
}

// ---------- pure-function checks ----------

export interface PureResult {
  name: string;
  pass: boolean | null;
  detail: string;
}

function pureChecks(c: EvalCase): PureResult[] {
  const out: PureResult[] = [];
  const m = c.moment;
  const best = judgeAttempt(m, m.lines[0].move).verdict;
  out.push({ name: "verdict(best)=best", pass: best === "best", detail: best });
  const played = judgeAttempt(m, m.played).verdict;
  const playedOk = played === "mistake" || played === "inaccuracy";
  out.push({ name: "verdict(played)=mistake|inaccuracy", pass: playedOk, detail: played });
  if (c.label?.humanGuess) {
    const g = judgeAttempt(m, c.label.humanGuess).verdict;
    out.push({ name: "verdict(humanGuess)", pass: null, detail: `${c.label.humanGuess} -> ${g}` });
  }
  out.push(...checkIdeas(c));
  return out;
}

// ---------- run ----------

interface RungResult {
  stage: Stage;
  source: "llm" | "fallback";
  tries: number;
  errors: string[];
  reply: CoachReply;
  leak: LeakResult;
  guess?: { move: string; hit: boolean };
  judge?: JudgeResult;
  ms: number;
}

interface CaseResult {
  id: string;
  tags: string[];
  pure: PureResult[];
  baseline?: { move: string; hit: boolean };
  humanGuess?: { move: string; hit: boolean };
  rungs: RungResult[];
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  const good = new Set(goodCandidates(c.moment));
  const hit = (mv: string) => good.has(normSan(mv));
  const result: CaseResult = { id: c.id, tags: c.tags, pure: pureChecks(c), rungs: [] };
  if (c.label?.humanGuess) result.humanGuess = { move: c.label.humanGuess, hit: hit(c.label.humanGuess) };
  if (!opts.llm) return result;

  if (opts.leak) {
    const g = await guessMove(c.moment.fenBefore, []);
    result.baseline = { move: g, hit: hit(g) };
  }

  const history: CoachTurn[] = [];
  const shown: Shown[] = [];
  const base: Omit<CoachRequest, "stage"> = { game: c.game, moment: c.moment, player: c.player };
  for (const stage of opts.stages) {
    const attempt = stage === "attempt" ? c.attempt : undefined;
    const req: CoachRequest = { ...base, stage, attempt, history: [...history] };
    const t0 = Date.now();
    const res = await generateCoachReply(req);
    const ms = Date.now() - t0;
    const errors = res.errors ?? [];
    const tries = res.source === "fallback" ? 2 : errors.some((e) => e.startsWith("try 1")) ? 2 : 1;
    const rung: RungResult = { stage, source: res.source, tries, errors, reply: res.reply, leak: leakCheck(res.reply, req), ms };
    history.push({ stage, attempt, text: res.reply.text });
    shown.push({
      stage,
      text: res.reply.text,
      arrows: res.reply.arrows.map((a) => `${a.from}-${a.to}`),
      squares: res.reply.squares,
      // The UI shows the motif once the attempt rung is past.
      motif: stage === "attempt" ? undefined : res.reply.motif,
    });
    if (opts.leak) {
      const g = await guessMove(c.moment.fenBefore, shown);
      rung.guess = { move: g, hit: hit(g) };
    }
    if (opts.judge && res.source === "llm") rung.judge = await judgeReply(c, stage, res.reply);
    result.rungs.push(rung);
    process.stderr.write(`${c.id} ${stage}: ${res.source} ${rung.leak.pass ? "ok" : "LEAK"} ${ms}ms\n`);
  }
  return result;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const pct = (num: number, den: number) => (den === 0 ? "  -  " : `${((100 * num) / den).toFixed(0).padStart(3)}%`);

function summarize(results: CaseResult[]) {
  const lines: string[] = [];
  // Pure checks.
  const pure = results.flatMap((r) => r.pure);
  const byName = new Map<string, { pass: number; total: number; info: string[] }>();
  for (const p of pure) {
    const e = byName.get(p.name) ?? { pass: 0, total: 0, info: [] };
    if (p.pass === null) e.info.push(p.detail);
    else {
      e.total++;
      if (p.pass) e.pass++;
    }
    byName.set(p.name, e);
  }
  lines.push("Pure-function checks");
  for (const [name, e] of byName) {
    lines.push(`  ${name.padEnd(40)} ${e.total ? `${pct(e.pass, e.total)} (${e.pass}/${e.total})` : `info: ${e.info.join("; ")}`}`);
  }
  // Human guess.
  const hg = results.filter((r) => r.humanGuess);
  lines.push(`  ${"human guess hits a good move".padEnd(40)} ${pct(hg.filter((r) => r.humanGuess!.hit).length, hg.length)} (${hg.length} labelled)`);

  if (!results.some((r) => r.rungs.length)) return lines.join("\n");

  lines.push("", "Per rung".padEnd(10) + "n   llm  try2  fallbk leak-ok  guess  judge: idea  no-give  depth  no-force");
  const bl = results.filter((r) => r.baseline);
  lines.push(`  ${"baseline".padEnd(8)} ${String(bl.length).padStart(2)}                              ${pct(bl.filter((r) => r.baseline!.hit).length, bl.length)}`);
  for (const stage of opts.stages) {
    const rs = results.flatMap((r) => r.rungs.filter((x) => x.stage === stage));
    const n = rs.length;
    const llm = rs.filter((x) => x.source === "llm").length;
    const try2 = rs.filter((x) => x.tries >= 2).length;
    const fb = rs.filter((x) => x.source === "fallback").length;
    const ok = rs.filter((x) => x.leak.pass).length;
    const g = rs.filter((x) => x.guess);
    const j = rs.filter((x) => x.judge);
    lines.push(
      `  ${stage.padEnd(8)} ${String(n).padStart(2)}  ${pct(llm, n)} ${pct(try2, n)} ${pct(fb, n)}  ${pct(ok, n)}   ${pct(g.filter((x) => x.guess!.hit).length, g.length)}        ${pct(j.filter((x) => x.judge!.namesIdea).length, j.length)}   ${pct(j.filter((x) => !x.judge!.giveaway).length, j.length)}  ${pct(j.filter((x) => x.judge!.depthFitsRating).length, j.length)}  ${pct(j.filter((x) => !x.judge!.forcedStyle).length, j.length)}`,
    );
  }
  // Leak details.
  const leaks = results.flatMap((r) => r.rungs.filter((x) => !x.leak.pass).map((x) => ({ id: r.id, x })));
  if (leaks.length) {
    lines.push("", "Leak check failures");
    for (const { id, x } of leaks) {
      const L = x.leak;
      const why = [
        L.illegalMoves.length ? `illegal ${L.illegalMoves.join(",")}` : "",
        L.giveaway.length ? `giveaway ${L.giveaway.join(",")}` : "",
        L.pieceSquare.length && x.stage !== "piece" ? `piece+square ${L.pieceSquare.join(",")}` : "",
        L.bullets > MAX_BULLETS ? `${L.bullets} bullets` : "",
        L.overWordCap ? `${L.words} words` : "",
        L.personWords.length ? `person: ${L.personWords.join(",")}` : "",
        L.noCandidateNamed ? "no candidate named" : "",
      ].filter(Boolean);
      lines.push(`  ${id} ${x.stage} [${x.source}]: ${why.join("; ")}`);
    }
  }
  const piecePs = results.flatMap((r) => r.rungs.filter((x) => x.stage === "piece" && x.leak.pieceSquare.length));
  if (piecePs.length) lines.push("", `piece rung names piece+target square in ${piecePs.length} replies (informational)`);
  return lines.join("\n");
}

async function main() {
  let cases = JSON.parse(readFileSync("evals/cases.json", "utf8")) as EvalCase[];
  if (opts.cases) cases = cases.filter((c) => opts.cases!.includes(c.id));
  cases = cases.slice(0, opts.limit);
  process.stderr.write(`${cases.length} cases, stages ${opts.stages.join(",")}, llm=${opts.llm} leak=${opts.leak} judge=${opts.judge}\n`);
  const t0 = Date.now();
  const results = await pool(cases, opts.concurrency, runCase);
  const summary = summarize(results);
  console.log(summary);
  writeFileSync(
    opts.out,
    JSON.stringify({ ranAt: new Date().toISOString(), options: opts, seconds: Math.round((Date.now() - t0) / 1000), summary, results }, null, 2) + "\n",
  );
  process.stderr.write(`wrote ${opts.out} in ${Math.round((Date.now() - t0) / 1000)}s\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
