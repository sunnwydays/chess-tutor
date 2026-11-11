import { Chess } from "chess.js";
import type { CoachReply, CoachRequest, Stage } from "./schema";
import { goodCandidates, normSan } from "./verdict";
import type { AttemptJudgement } from "./verdict";

const HIDDEN_STAGES: Stage[] = ["attempt", "nudge", "hint"];
const SAN_RE = /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8]=[QRBN])[+#]?/g;
const MAX_POINTS = 3;

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

function countPoints(text: string): number {
  const bullets = text.split("\n").filter((l) => /^\s*(-|\*|\d+[.)])\s+/.test(l)).length;
  return bullets;
}

/**
 * Check a coach reply against the position and the engine. Returns a list of
 * problems (empty = valid). Every check is cheap and deterministic.
 */
export function validateReply(
  reply: CoachReply,
  req: CoachRequest,
  judgement: AttemptJudgement | null,
): string[] {
  const errors: string[] = [];
  const moment = req.moment;
  const legal = legalSans(moment.fenBefore);
  const candidates = new Set(moment.lines.map((l) => normSan(l.move)));

  // Moves the coach may refer to: legal now, in an engine line, the played move, or earlier game moves.
  const known = new Set<string>(legal);
  for (const l of moment.lines) for (const s of l.pv) known.add(normSan(s));
  if (moment.punish) for (const s of moment.punish.pv) known.add(normSan(s));
  known.add(normSan(moment.played));
  for (const s of req.game.moves) known.add(normSan(s));

  // 1. Every SAN in `moves` must be legal now or appear in an engine line / the game.
  for (const m of reply.moves) {
    if (!known.has(normSan(m))) errors.push(`moves: "${m}" is not a legal move here and not in the engine lines`);
  }
  // 2. Every SAN-looking token in the text must be a known move.
  for (const t of sanTokens(reply.text)) {
    if (!known.has(t)) errors.push(`text: "${t}" is not a legal move here and not in the engine lines`);
  }
  // 3. Square syntax (the schema enforces the pattern, but a fallback path might not).
  for (const a of reply.arrows) {
    if (!/^[a-h][1-8]$/.test(a.from) || !/^[a-h][1-8]$/.test(a.to)) errors.push(`arrows: bad squares ${a.from}-${a.to}`);
  }
  for (const s of reply.squares) {
    if (!/^[a-h][1-8]$/.test(s)) errors.push(`squares: bad square ${s}`);
  }
  // 4. Early rungs must not give away the answer.
  if (HIDDEN_STAGES.includes(req.stage)) {
    let hidden = goodCandidates(moment);
    const attempt = req.attempt ? normSan(req.attempt) : null;
    if (req.stage === "attempt" && attempt && judgement && (judgement.verdict === "best" || judgement.verdict === "good")) {
      hidden = hidden.filter((h) => h !== attempt);
    }
    const chess = new Chess(moment.fenBefore);
    for (const h of hidden) {
      if (mentions(reply.text, h)) errors.push(`stage ${req.stage}: text names the candidate move ${h}`);
      if (reply.moves.some((m) => normSan(m) === h)) errors.push(`stage ${req.stage}: moves lists the candidate move ${h}`);
      const mv = chess.move(h);
      if (mv) {
        chess.undo();
        if (reply.arrows.some((a) => a.from === mv.from && a.to === mv.to)) {
          errors.push(`stage ${req.stage}: an arrow draws the candidate move ${h}`);
        }
      }
    }
  }
  // 5. Late rungs must name an engine candidate, and the first move listed must be one.
  if (req.stage === "move" || req.stage === "explain") {
    const named = reply.moves.map(normSan).filter((m) => candidates.has(m));
    if (named.length === 0) errors.push(`stage ${req.stage}: no engine candidate move is listed in moves`);
    if (reply.moves.length > 0 && !candidates.has(normSan(reply.moves[0]))) {
      errors.push(`stage ${req.stage}: moves[0] "${reply.moves[0]}" is not one of the engine's candidates`);
    }
    if (!moment.lines.some((l) => mentions(reply.text, l.move))) {
      errors.push(`stage ${req.stage}: text does not mention any engine candidate`);
    }
  }
  // 6. Max 3 points.
  const points = countPoints(reply.text);
  if (points > MAX_POINTS) errors.push(`text has ${points} bullet points (max ${MAX_POINTS})`);
  if (reply.text.trim().length === 0) errors.push("text is empty");

  return errors;
}

/** Deterministic engine-only reply for when the model fails validation twice. */
export function fallbackReply(req: CoachRequest, judgement: AttemptJudgement | null): CoachReply {
  const m = req.moment;
  const best = m.lines[0];
  const chess = new Chess(m.fenBefore);
  const bestMv = best ? chess.move(best.move) : null;
  if (bestMv) chess.undo();
  const ev = (cp: number) => (cp / 100).toFixed(2);
  const empty: CoachReply = { text: "", moves: [], arrows: [], squares: [], motif: "" };

  switch (req.stage) {
    case "attempt": {
      const v = judgement?.verdict ?? "unknown";
      const text =
        v === "best"
          ? `${req.attempt} is the engine's top choice here (eval ${best ? ev(best.evalCp) : "?"}).`
          : v === "unknown"
            ? `The engine didn't analyse ${req.attempt}, so no verdict on it. Try another move or ask for a nudge.`
            : `${req.attempt} loses about ${judgement?.wpLoss?.toFixed(0) ?? "?"} win-probability points compared with the best move. Try again or ask for a nudge.`;
      return { ...empty, text, moves: req.attempt ? [req.attempt] : [] };
    }
    case "nudge":
      return { ...empty, text: "Look at what the opponent threatens next move, and at which of your pieces is undefended." };
    case "hint":
      return {
        ...empty,
        text: "The best move starts from the highlighted square.",
        squares: bestMv ? [bestMv.from] : [],
      };
    case "move":
      return best
        ? {
            ...empty,
            text: `The engine's best move is ${best.move} (eval ${ev(best.evalCp)}).`,
            moves: [best.move],
            arrows: bestMv ? [{ from: bestMv.from, to: bestMv.to }] : [],
          }
        : { ...empty, text: "No engine line available for this position." };
    case "explain":
      return best
        ? {
            ...empty,
            text: `Best: ${best.move} (eval ${ev(best.evalCp)}), line ${best.pv.join(" ")}.\nPlayed: ${m.played} (eval ${ev(m.evalAfter)}).`,
            moves: [best.move],
            arrows: bestMv ? [{ from: bestMv.from, to: bestMv.to }] : [],
          }
        : { ...empty, text: "No engine line available for this position." };
  }
}
