import type { MomentAnalysis } from "@/lib/engine/types";

/**
 * Rungs of the hint ladder, in order. attempt: verdict on the tried move.
 * focus: the area of the board (zone highlighted, other pieces faded).
 * threat: the opponent's idea drawn as red arrows. piece: the piece that has
 * to move (its square highlighted). move: the move. explain: the full picture.
 */
export const STAGES = ["attempt", "focus", "threat", "piece", "move", "explain"] as const;
export type Stage = (typeof STAGES)[number];

/** Server-side verdict on the user's attempt; the engine decides, not the LLM. */
export type AttemptVerdict = "best" | "good" | "inaccuracy" | "mistake" | "unknown";

export interface CoachArrow {
  from: string;
  to: string;
  /** "threat" = the opponent's idea (drawn red); "move" = a move for the player (drawn green). */
  kind: "threat" | "move";
}

/** What the LLM returns; the board renders it. */
export interface CoachReply {
  /** What the coach says. Short; max 3 points. Markdown bullets allowed. */
  text: string;
  /** SAN moves the reply refers to (legal from the moment's position). */
  moves: string[];
  /** Arrows to draw on the board. Threat arrows only before the move rung. */
  arrows: CoachArrow[];
  /** Squares to highlight. At focus (zone) and piece (from-squares) the server fills these from the engine. */
  squares: string[];
  /** Short tactical/positional motif tag, e.g. "pin", "back-rank weakness". Hidden until after the attempt. */
  motif: string;
}

export const COACH_REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "moves", "arrows", "squares", "motif"],
  properties: {
    text: { type: "string" },
    moves: { type: "array", items: { type: "string" } },
    arrows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "kind"],
        properties: {
          from: { type: "string", pattern: "^[a-h][1-8]$" },
          to: { type: "string", pattern: "^[a-h][1-8]$" },
          kind: { type: "string", enum: ["threat", "move"] },
        },
      },
    },
    squares: { type: "array", items: { type: "string", pattern: "^[a-h][1-8]$" } },
    motif: { type: "string" },
  },
} as const;

export interface GameContext {
  white: { username: string; rating: number };
  black: { username: string; rating: number };
  userColor: "white" | "black";
  result: "win" | "loss" | "draw";
  timeClass: string;
  opening?: string;
  /** Every move of the game in SAN. */
  moves: string[];
}

export interface PlayerContext {
  /** The user's rating in this game's time class. */
  rating: number;
}

/** One earlier exchange on this moment, so the coach doesn't repeat itself. */
export interface CoachTurn {
  stage: Stage;
  attempt?: string;
  text: string;
}

export interface CoachRequest {
  game: GameContext;
  moment: MomentAnalysis;
  player: PlayerContext;
  stage: Stage;
  /** The user's attempt in SAN (required at stage "attempt"). */
  attempt?: string;
  /** Eval of the attempt (user POV, cp) if the client analysed it and it wasn't in MultiPV. */
  attemptEvalCp?: number;
  history?: CoachTurn[];
}

export interface CoachResponse {
  reply: CoachReply;
  /** "llm" when the validated model reply is shown, "fallback" for the engine-only text. */
  source: "llm" | "fallback";
  attemptVerdict: AttemptVerdict | null;
  /** Validation errors from the attempts that failed (for debugging / eval). */
  errors?: string[];
}
