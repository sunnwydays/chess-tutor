import { Chess } from "chess.js";
import { hiddenPieces, isOpponentThreat, type IdeaFeatures } from "@/lib/engine/ideas";
import type { CoachReply, CoachRequest, Stage } from "./schema";
import { goodCandidates, normSan } from "./verdict";
import type { AttemptJudgement } from "./verdict";

/** Rungs before the move is revealed. */
export const HIDDEN_STAGES: Stage[] = ["attempt", "focus", "threat", "piece"];
const SAN_RE = /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8]=[QRBN])[+#]?/g;
const SQUARE_RE = /(^|[^A-Za-z0-9])([a-h][1-8])(?![A-Za-z0-9])/g;
const PIECE_WORD: Record<string, string> = { king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p" };
const PIECE_RE = /\b(king|queen|rook|bishop|knight|pawn)s?\b/gi;
const PERSON_RE = /\b(careless|sloppy|lazy|obvious(ly)?|silly|you (missed|should have|overlooked|forgot))\b/i;
const MAX_POINTS = 3;

/** Length caps per rung: words, and sentences where the rung is "N sentences". */
export const CAPS: Record<Stage, { words: number; sentences?: number }> = {
  attempt: { words: 35, sentences: 1 },
  focus: { words: 15 },
  threat: { words: 25 },
  piece: { words: 25 },
  move: { words: 45, sentences: 2 },
  explain: { words: 80 },
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `text` mention `san` as a whole token (so "e4" doesn't match "e45" or "Re4")? */
export function mentions(text: string, san: string): boolean {
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(normSan(san))}(?![A-Za-z0-9=])`);
  return re.test(text);
}

/** Legal moves at a FEN, normalized SAN. */
export function legalSans(fen: string): Set<string> {
  return new Set(new Chess(fen).moves().map(normSan));
}

/** SAN-looking tokens in prose (bare squares like "e4" are skipped: they may be square names). */
export function sanTokens(text: string): string[] {
  return Array.from(text.matchAll(SAN_RE), (m) => normSan(m[1]));
}

/** Bare square names in prose. */
export function squareTokens(text: string): string[] {
  return Array.from(text.matchAll(SQUARE_RE), (m) => m[2]);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countSentences(text: string): number {
  return (text.match(/[.!?]+(?=\s|$)/g) ?? []).length || 1;
}

function countPoints(text: string): number {
  return text.split("\n").filter((l) => /^\s*(-|\*|\d+[.)])\s+/.test(l)).length;
}

/** The moves that must stay hidden at this rung (good candidates, minus a good attempt). */
export function hiddenAt(req: CoachRequest, judgement: AttemptJudgement | null): string[] {
  let hidden = goodCandidates(req.moment);
  const attempt = req.attempt ? normSan(req.attempt) : null;
  if (req.stage === "attempt" && attempt && judgement && (judgement.verdict === "best" || judgement.verdict === "good")) {
    hidden = hidden.filter((h) => h !== attempt);
  }
  return hidden;
}

/**
 * Check a coach reply against the position, the engine and the rung. Returns a
 * list of problems (empty = valid). Every check is cheap and deterministic.
 */
export function validateReply(
  reply: CoachReply,
  req: CoachRequest,
  judgement: AttemptJudgement | null,
  features: IdeaFeatures,
): string[] {
  const errors: string[] = [];
  const moment = req.moment;
  const stage = req.stage;
  const legal = legalSans(moment.fenBefore);
  const candidates = new Set(moment.lines.map((l) => normSan(l.move)));
  const chess = new Chess(moment.fenBefore);

  // Moves the coach may refer to: legal now, in an engine line, the played move, or earlier game moves.
  const known = new Set<string>(legal);
  for (const l of moment.lines) for (const s of l.pv) known.add(normSan(s));
  if (moment.punish) for (const s of moment.punish.pv) known.add(normSan(s));
  known.add(normSan(moment.played));
  for (const s of req.game.moves) known.add(normSan(s));

  // 1. Every SAN in `moves` and every SAN-looking token in the text must be a known move.
  for (const m of reply.moves) {
    if (!known.has(normSan(m))) errors.push(`moves: "${m}" is not a legal move here and not in the engine lines`);
  }
  for (const t of sanTokens(reply.text)) {
    if (!known.has(t)) errors.push(`text: "${t}" is not a legal move here and not in the engine lines`);
  }
  // 2. Square syntax (the schema enforces the pattern, but a fallback path might not).
  for (const a of reply.arrows) {
    if (!/^[a-h][1-8]$/.test(a.from) || !/^[a-h][1-8]$/.test(a.to)) errors.push(`arrows: bad squares ${a.from}-${a.to}`);
  }
  for (const s of reply.squares) {
    if (!/^[a-h][1-8]$/.test(s)) errors.push(`squares: bad square ${s}`);
  }
  // 3. Arrows must be real moves: "move" arrows legal for the player, "threat" arrows legal for the opponent.
  for (const a of reply.arrows) {
    if (a.kind === "threat" && !isOpponentThreat(moment.fenBefore, a.from, a.to)) {
      errors.push(`arrows: threat ${a.from}-${a.to} is not a move the opponent could play here`);
    }
    if (a.kind === "move" && !chess.moves({ verbose: true }).some((mv) => mv.from === a.from && mv.to === a.to)) {
      errors.push(`arrows: move ${a.from}-${a.to} is not a legal move here`);
    }
  }

  // 4. Early rungs must not give away the answer.
  if (HIDDEN_STAGES.includes(stage)) {
    const hidden = hiddenAt(req, judgement);
    const hiddenTo = new Set<string>();
    for (const h of hidden) {
      if (mentions(reply.text, h)) errors.push(`stage ${stage}: text names the good move ${h}`);
      if (reply.moves.some((m) => normSan(m) === h)) errors.push(`stage ${stage}: moves lists the good move ${h}`);
      let mv: ReturnType<Chess["move"]> | null = null;
      try {
        mv = chess.move(h);
        chess.undo();
      } catch {}
      if (!mv) continue;
      hiddenTo.add(mv.to);
      if (reply.arrows.some((a) => a.from === mv.from && a.to === mv.to)) {
        errors.push(`stage ${stage}: an arrow draws the good move ${h}`);
      }
    }
    for (const sq of squareTokens(reply.text)) {
      if (hiddenTo.has(sq)) errors.push(`stage ${stage}: text mentions ${sq}, the destination of a good move`);
    }
    if (reply.arrows.some((a) => a.kind === "move")) errors.push(`stage ${stage}: no "move" arrows before the move rung`);
    if (stage !== "threat" && reply.arrows.length > 0) errors.push(`stage ${stage}: arrows must be empty`);
    if (stage !== "attempt" && reply.moves.length > 0) errors.push(`stage ${stage}: moves must be empty`);
    if (stage === "focus") {
      const pieces = hiddenPieces(moment);
      for (const w of reply.text.matchAll(PIECE_RE)) {
        if (pieces.has(PIECE_WORD[w[1].toLowerCase()])) errors.push(`stage focus: text names the ${w[1]}, the piece a good move uses`);
      }
      if (sanTokens(reply.text).length) errors.push("stage focus: text contains a move");
    }
    if (stage === "threat") {
      if (!reply.arrows.some((a) => a.kind === "threat")) errors.push("stage threat: needs at least one threat arrow");
      if (reply.arrows.length > 3) errors.push("stage threat: at most 3 arrows");
    }
  }
  // 5. Late rungs must name an engine candidate, and the first move listed must be one.
  if (stage === "move" || stage === "explain") {
    const named = reply.moves.map(normSan).filter((m) => candidates.has(m));
    if (named.length === 0) errors.push(`stage ${stage}: no engine candidate move is listed in moves`);
    if (reply.moves.length > 0 && !candidates.has(normSan(reply.moves[0]))) {
      errors.push(`stage ${stage}: moves[0] "${reply.moves[0]}" is not one of the engine's candidates`);
    }
    if (!moment.lines.some((l) => mentions(reply.text, l.move))) {
      errors.push(`stage ${stage}: text does not mention any engine candidate`);
    }
    if (stage === "move" && features.goodMoves.length && !features.goodMoves.some((g) => mentions(reply.text, g))) {
      errors.push("stage move: text does not name a good move");
    }
  }
  // 6. Length, bullets, tone.
  const cap = CAPS[stage];
  const words = countWords(reply.text);
  if (words > cap.words) errors.push(`text has ${words} words (max ${cap.words} at ${stage})`);
  if (cap.sentences !== undefined) {
    const n = countSentences(reply.text);
    if (n > cap.sentences) errors.push(`text has ${n} sentences (max ${cap.sentences} at ${stage})`);
  }
  const points = countPoints(reply.text);
  if (points > MAX_POINTS) errors.push(`text has ${points} bullet points (max ${MAX_POINTS})`);
  const person = reply.text.match(PERSON_RE);
  if (person) errors.push(`text judges the person ("${person[0]}")`);
  if (reply.text.trim().length === 0) errors.push("text is empty");

  return errors;
}

/**
 * After validation: the board decorations the engine owns. focus -> zone squares,
 * piece -> from-squares, attempt -> nothing. The LLM's own squares/arrows stay
 * only at threat (arrows), move and explain.
 */
export function decorateReply(reply: CoachReply, req: CoachRequest, features: IdeaFeatures): CoachReply {
  switch (req.stage) {
    case "attempt":
      return { ...reply, arrows: [], squares: [] };
    case "focus":
      return { ...reply, arrows: [], squares: features.zone };
    case "threat":
      return { ...reply, squares: [] };
    case "piece":
      return { ...reply, arrows: [], squares: features.pieceSquares };
    default:
      return reply;
  }
}

/** Deterministic engine-only reply for when the model fails validation twice. */
export function fallbackReply(req: CoachRequest, judgement: AttemptJudgement | null, features: IdeaFeatures): CoachReply {
  const m = req.moment;
  const best = m.lines[0];
  const chess = new Chess(m.fenBefore);
  let bestMv: ReturnType<Chess["move"]> | null = null;
  try {
    bestMv = best ? chess.move(best.move) : null;
    if (bestMv) chess.undo();
  } catch {}
  const ev = (cp: number) => (cp / 100).toFixed(2);
  const empty: CoachReply = { text: "", moves: [], arrows: [], squares: [], motif: "" };
  const bestArrow = bestMv ? [{ from: bestMv.from, to: bestMv.to, kind: "move" as const }] : [];

  switch (req.stage) {
    case "attempt": {
      const v = judgement?.verdict ?? "unknown";
      const text =
        v === "best" || v === "good"
          ? `${req.attempt} is ${v === "best" ? "the engine's top choice" : "one of the engine's good moves"} here (eval ${ev(judgement?.evalCp ?? 0)}).`
          : v === "unknown"
            ? `The engine didn't analyse ${req.attempt}, so no verdict on it; try another move or ask where to look.`
            : `${req.attempt} loses about ${judgement?.wpLoss?.toFixed(0) ?? "?"} win-probability points compared with the best move.`;
      return { ...empty, text, moves: req.attempt ? [req.attempt] : [] };
    }
    case "focus":
      return { ...empty, text: "The idea lives in the highlighted area. What is going on there?", squares: features.zone };
    case "threat": {
      // The opponent's punishing reply, if it is also a threat in the current position.
      let arrows: CoachReply["arrows"] = [];
      if (m.punish) {
        try {
          const after = new Chess(m.fenBefore);
          after.move(m.played);
          const mv = after.move(m.punish.move);
          if (isOpponentThreat(m.fenBefore, mv.from, mv.to)) arrows = [{ from: mv.from, to: mv.to, kind: "threat" }];
        } catch {}
      }
      return { ...empty, text: arrows.length ? "The red arrow is what the opponent is after." : "Ask what the opponent would play if it were their move.", arrows };
    }
    case "piece":
      return { ...empty, text: "The highlighted piece is the one that should move.", squares: features.pieceSquares };
    case "move":
      return best
        ? { ...empty, text: `The engine's best move is ${best.move} (eval ${ev(best.evalCp)}).`, moves: [best.move], arrows: bestArrow }
        : { ...empty, text: "No engine line available for this position." };
    case "explain":
      return best
        ? {
            ...empty,
            text: `Best: ${best.move} (eval ${ev(best.evalCp)}), line ${best.pv.join(" ")}.\nPlayed: ${m.played} (eval ${ev(m.evalAfter)}).${features.goodMoves.length > 1 ? `\nAlso good: ${features.goodMoves.slice(1).join(", ")}.` : ""}`,
            moves: [best.move],
            arrows: bestArrow,
          }
        : { ...empty, text: "No engine line available for this position." };
  }
}
