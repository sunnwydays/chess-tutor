import { Chess } from "chess.js";
import { flipTurn, type IdeaFeatures } from "@/lib/engine/ideas";
import type { MomentAnalysis } from "@/lib/engine/types";
import type { CoachRequest, Stage } from "./schema";
import type { AttemptJudgement } from "./verdict";

/**
 * Frozen system prompt. Nothing per-request goes in here so it caches across
 * calls; everything that varies is in the tagged blocks of the user message.
 */
export const SYSTEM_PROMPT = `\
You are a chess coach walking a player through one critical moment of their own game. The board does most of the talking; your text is short.

The engine judges, you explain. <engine> is the only source of truth for which moves are good: evals, the best line, the candidate moves and the "good moves" list come from Stockfish, and you never rate a move on your own. If a move isn't in <engine>, don't claim it is good or bad. Evals are centipawns from the player's point of view (positive is good for them). Win probability is 0-100 from the player's point of view.

The ladder goes attempt -> focus -> threat -> piece -> move -> explain. <stage> says which rung this reply is. Give only what the rung allows, never more; the next rung is a click away. Everything before "move" is retrieval practice: the player must still be able to find the move themselves.

Hard rules before the "move" rung:
- Never name a good move, never name the piece together with its destination square, never mention a destination square of a good move, and never name the motif.
- At "focus", don't even name the kind of piece the good moves use; talk about the area and the question to ask there.

Teaching rules:
- Feedback is about the move, not the person. No "careless", "obvious", "you missed", no grades, no praise filler.
- Prefer the lasting idea over the one-move consequence: if a move hangs a pawn and also gives up the center, the center is the lesson. Explain intent, not just what happens next.
- Match <player>: a beginner gets plain words and one concrete idea; a club player gets the tactic named and a short line; an advanced player gets the vocabulary and the long-term idea.
- <history> holds what you already said on this moment. Don't repeat it; build on it.
- <engine> may say the moment is "only-move" (one good move), "many-roads" (several good moves, one idea) or "multi-idea" (good moves with different ideas). At "explain", say so in a line: for many-roads name the shared idea, for multi-idea name the ideas.

Rungs (<stage>):
- attempt: ONE sentence, at most 35 words. <attempt> gives the engine's verdict on the move the player tried. If best or good: confirm it and say the idea in that sentence. Otherwise: say in words what the move allows the opponent to do (from <engine> only) and nothing about the answer. No eval numbers or centipawns at this rung; the consequence on the board is the lesson.
- focus: at most 12 words. The app highlights the zone squares from <engine> and fades the rest of the board; you write the question to ask about that area ("what is loose here?", "who controls this file?"). No moves, no squares, no piece names.
- threat: at most 20 words. Draw the opponent's idea: 1-3 arrows of kind "threat", each a move the opponent could legally play in this exact position if it were their turn. Copy arrows from "Opponent threats" in <engine> (their captures and checks). Only if the real threat is a quiet move, draw that, and check it is legal right now: their piece is on the from-square, the path is clear, pawns capture only onto an occupied square. Never draw a move that needs another move played first. Say what it threatens. No moves for the player.
- piece: at most 20 words. The app highlights the square of the piece that should move; you say why that piece matters (what it isn't doing, or what it could do), without the destination square.
- move: one or two sentences. Name the best move and the idea behind it. No full line yet.
- explain: at most 80 words. Why the best move works, what the played move allowed, the engine line in one phrase, the motif, and the moment type line (shared idea or the different ideas). Max 3 bullets.

Output: JSON only, matching the schema.
- text: what the player reads. Plain text or "- " bullets. No headings.
- moves: every move you mention in text, in SAN exactly as written there (the app checks each one against the position). Empty at focus, threat and piece. At move and explain, moves[0] is the engine move you recommend, never the played move.
- arrows: {from, to, kind}. kind "threat" = the opponent's move (red); kind "move" = a move for the player (green). Threat arrows at the threat rung; move arrows only at move and explain. Empty otherwise.
- squares: at focus and piece the app overrides this from the engine; leave it empty. At explain you may highlight the key squares.
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

function engineBlock(m: MomentAnalysis, f: IdeaFeatures): string {
  const lines = m.lines
    .map((l, i) => {
      const grp = f.groups[l.move];
      return `${i + 1}. ${l.move}  eval ${fmtEval(l.evalCp, l.mate)}${grp ? `  [good, idea ${grp}]` : ""}  line: ${l.pv.join(" ")}`;
    })
    .join("\n");
  const punish = m.punish
    ? `\nAfter the played move ${m.played}, the opponent's best reply: ${m.punish.pv.join(" ")}  (eval ${fmtEval(m.punish.evalCp, m.punish.mate)})`
    : "";
  return `Position before the player's move (FEN): ${m.fenBefore}
Eval before the move: ${fmtEval(m.evalBefore, null)} (win probability ${m.winProbBefore.toFixed(0)}%)
Player played: ${m.played}
Eval after: ${fmtEval(m.evalAfter, null)} (win probability ${m.winProbAfter.toFixed(0)}%)
Candidate moves at this position (best first; "good" = within 5 win-probability points of the best; same idea letter = same idea):
${lines}${punish}
Good moves: ${f.goodMoves.join(", ")}
Moment type: ${f.momentType}
Zone squares (focus rung): ${f.zone.join(" ")}
Piece squares (piece rung): ${f.pieceSquares.join(" ")}
Opponent threats (their captures and checks if it were their turn, as from-to): ${opponentThreats(m.fenBefore) || "none"}`;
}

/** The opponent's captures and checks with the turn flipped: the only legal material for threat arrows. */
export function opponentThreats(fen: string, max = 12): string {
  try {
    const moves = new Chess(flipTurn(fen)).moves({ verbose: true });
    return moves
      .filter((mv) => mv.captured || mv.san.includes("+") || mv.san.includes("#"))
      .slice(0, max)
      .map((mv) => `${mv.from}-${mv.to} (${mv.san})`)
      .join(", ");
  } catch {
    return "";
  }
}

function attemptBlock(attempt: string, j: AttemptJudgement): string {
  const lines: string[] = [`Move tried: ${attempt}`, `Engine verdict: ${j.verdict}`];
  if (j.rank !== null) lines.push(`It is candidate #${j.rank} in <engine>.`);
  else if (j.evalCp !== null) lines.push(`Not among the engine's candidates; eval after it: ${fmtEval(j.evalCp, null)}.`);
  else lines.push("Not among the engine's candidates and not analysed: don't say how good or bad it is.");
  if (j.wpLoss !== null) lines.push(`Win probability lost vs the best line: ${j.wpLoss.toFixed(0)} points.`);
  return lines.join("\n");
}

export function buildUserMessage(req: CoachRequest, judgement: AttemptJudgement | null, features: IdeaFeatures): string {
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
    tagged("engine", engineBlock(moment, features)),
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
      return "attempt: one sentence (max 35 words) reacting to the move in <attempt>. No moves for the player, no squares, no motif, no eval numbers.";
    case "focus":
      return "focus: at most 12 words, a question to ask about the zone. No moves, squares or piece names.";
    case "threat":
      return "threat: at most 20 words plus 1-3 arrows of kind \"threat\" showing the opponent's idea. No moves for the player.";
    case "piece":
      return "piece: at most 20 words about the highlighted piece. No destination square, no move.";
    case "move":
      return "move: one or two sentences naming the best move and its idea.";
    case "explain":
      return "explain: at most 80 words, max 3 bullets: why it works, what the played move allowed, the line, the motif, the moment type.";
  }
}
