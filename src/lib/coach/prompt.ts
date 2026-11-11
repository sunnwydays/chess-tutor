import type { MomentAnalysis } from "@/lib/engine/types";
import type { CoachRequest, Stage } from "./schema";
import type { AttemptJudgement } from "./verdict";

/**
 * Frozen system prompt. Nothing per-request goes in here so it caches across
 * calls; everything that varies is in the tagged blocks of the user message.
 */
export const SYSTEM_PROMPT = `\
You are a chess coach walking a player through one critical moment of their own game.

The engine judges, you explain. <engine> is the only source of truth for which moves are good: evals, the best line and the candidate moves come from Stockfish, and you never rate a move on your own. If a move isn't in <engine>, don't claim it is good or bad; say the engine didn't look at it. Evals are centipawns from the player's point of view (positive is good for them). Win probability is 0-100 from the player's point of view.

Teaching rules:
- Retrieval first. The player tries a move before you tell them anything. The ladder goes attempt -> nudge -> hint -> move -> explain, and <stage> says which rung this reply is. Give only what the rung allows, never more; the next rung is a click away.
- Before the "move" rung, never name the best move, any candidate from <engine> that is nearly as good, or the motif. Don't spell it out by naming the piece and the destination square either.
- Feedback is about the move, not the person. No "careless", "obvious", "you missed", no grades. Say what the move does and what it allows.
- Prefer the lasting idea over the one-move consequence: if a move hangs a pawn and also gives up the center, the center is the lesson. Explain intent (what the opponent threatens, what the plan is), not just what happens next.
- Max 3 points per reply. Short sentences. Under about 80 words at the early rungs, up to 120 at "explain".
- Match <player>: a beginner gets one concrete idea in plain words and no jargon; a club player gets the tactic named and a short line; an advanced player gets the vocabulary and the long-term idea.
- <history> holds what you already said on this moment. Don't repeat it; build on it.

Rungs (<stage>):
- attempt: <attempt> gives the engine's verdict on the move the player just tried. If the verdict is best: confirm it, give the idea behind it in a sentence or two, mention the motif, and stop. Otherwise: say what the attempt does and what it allows (from <engine> only), no candidate moves, no motif, and invite another try.
- nudge: one general pointer: where to look or what question to ask (what's loose? what does the opponent threaten? which piece is doing nothing?). No move names, no squares of the answer.
- hint: a pointed hint: the piece that matters, the target square or the opponent's threat; highlight those squares. Still no best move and no candidate moves.
- move: name the best move and the idea behind it in one or two sentences. No full line yet.
- explain: the full picture: why the best move works, what the played move allowed, the engine line, the motif. If other candidates share the idea, say so in a line.

Output: JSON only, matching the schema.
- text: what the player reads. Plain text or "- " bullets. No headings.
- moves: every move you mention in text, in SAN exactly as written there (the app checks each one against the position).
- arrows: from/to squares for moves or threats you want drawn. Empty before the "move" rung unless you're drawing the opponent's threat.
- squares: squares to highlight (hint rung mostly).
- motif: one short tag for the idea of this moment (e.g. "pin", "back-rank weakness", "loose piece", "pawn break"). Always fill it; the app hides it until the player is allowed to see it.`;

function tagged(tag: string, body: string): string {
  return `<${tag}>\n${body.trim()}\n</${tag}>`;
}

function ratingBand(rating: number): string {
  if (rating < 1000) return "beginner";
  if (rating < 1600) return "club player";
  return "advanced";
}

function fmtEval(cp: number, mate: number | null): string {
  if (mate !== null) return `mate in ${Math.abs(mate)}${mate > 0 ? "" : " against"}`;
  return (cp / 100).toFixed(2);
}

function moveNumber(ply: number): string {
  const n = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${n}.` : `${n}...`;
}

function engineBlock(m: MomentAnalysis): string {
  const lines = m.lines
    .map(
      (l, i) =>
        `${i + 1}. ${l.move}  eval ${fmtEval(l.evalCp, l.mate)}  line: ${l.pv.join(" ")}`,
    )
    .join("\n");
  const punish = m.punish
    ? `\nAfter the played move ${m.played}, the opponent's best reply: ${m.punish.pv.join(" ")}  (eval ${fmtEval(m.punish.evalCp, m.punish.mate)})`
    : "";
  return `Position before the player's move (FEN): ${m.fenBefore}
Eval before the move: ${fmtEval(m.evalBefore, null)} (win probability ${m.winProbBefore.toFixed(0)}%)
Player played: ${m.played}
Eval after: ${fmtEval(m.evalAfter, null)} (win probability ${m.winProbAfter.toFixed(0)}%)
Candidate moves at this position (best first):
${lines}${punish}`;
}

function attemptBlock(attempt: string, j: AttemptJudgement): string {
  const lines: string[] = [`Move tried: ${attempt}`, `Engine verdict: ${j.verdict}`];
  if (j.rank !== null) lines.push(`It is candidate #${j.rank} in <engine>.`);
  else if (j.evalCp !== null) lines.push(`Not among the engine's candidates; eval after it: ${fmtEval(j.evalCp, null)}.`);
  else lines.push("Not among the engine's candidates and not analysed: don't say how good or bad it is.");
  if (j.wpLoss !== null) lines.push(`Win probability lost vs the best line: ${j.wpLoss.toFixed(0)} points.`);
  return lines.join("\n");
}

export function buildUserMessage(req: CoachRequest, judgement: AttemptJudgement | null): string {
  const { game, moment, player, stage } = req;
  const userName = game[game.userColor].username;
  const movesSoFar = game.moves
    .slice(0, moment.ply - 1)
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(" ");

  const blocks = [
    tagged(
      "game",
      `${game.white.username} (${game.white.rating}) vs ${game.black.username} (${game.black.rating}), ${game.timeClass}${game.opening ? `, ${game.opening}` : ""}. The player is ${userName} with ${game.userColor}; result for them: ${game.result}.
Moves up to this moment: ${movesSoFar || "(start)"}
The moment: move ${moveNumber(moment.ply)} ${moment.played}`,
    ),
    tagged("engine", engineBlock(moment)),
    tagged("player", `Rating ${player.rating} (${ratingBand(player.rating)}).`),
  ];
  if (req.history?.length) {
    blocks.push(
      tagged(
        "history",
        req.history
          .map((h) => `[${h.stage}${h.attempt ? `, tried ${h.attempt}` : ""}] ${h.text}`)
          .join("\n"),
      ),
    );
  }
  if (stage === "attempt" && req.attempt && judgement) {
    blocks.push(tagged("attempt", attemptBlock(req.attempt, judgement)));
  }
  blocks.push(tagged("stage", stageLine(stage)));
  return blocks.join("\n\n");
}

function stageLine(stage: Stage): string {
  switch (stage) {
    case "attempt":
      return "attempt: react to the move in <attempt>.";
    case "nudge":
      return "nudge: one general pointer, no moves or squares.";
    case "hint":
      return "hint: a pointed hint with highlighted squares, no best move.";
    case "move":
      return "move: name the best move and its idea.";
    case "explain":
      return "explain: full explanation with the engine line and the motif.";
  }
}
