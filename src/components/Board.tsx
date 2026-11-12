"use client";

import type { CSSProperties } from "react";
import { Chessboard } from "react-chessboard";

export interface BoardArrow {
  startSquare: string;
  endSquare: string;
  color: string;
}

/** Arrow colors: threat = opponent's idea, move = a move for the player, hover = SAN hover preview. */
export const ARROW_COLOR = {
  threat: "rgba(240,97,109,0.85)",
  move: "rgba(110,231,167,0.9)",
  hover: "rgba(127,180,255,0.9)",
} as const;

interface Props {
  fen: string;
  orientation: "white" | "black";
  arrows?: BoardArrow[];
  highlightSquares?: string[];
  /** CSS color for highlightSquares; default soft yellow. */
  highlightColor?: string;
  onMove?: (from: string, to: string) => boolean;
  onSquareClick?: (square: string) => void;
  /** Tunnel vision: when set, every other square (and its piece) is faded. */
  focus?: string[];
  /** Key squares drawn with a pulsing green ring. */
  pulseSquares?: string[];
  /** Soft accent tint on both squares of a move (replays, engine line stepping). */
  lastMove?: { from: string; to: string };
}

// The pulse-ring keyframes live in globals.css (top level, always emitted).
export default function Board({
  fen,
  orientation,
  arrows,
  highlightSquares,
  highlightColor,
  onMove,
  onSquareClick,
  focus,
  pulseSquares,
  lastMove,
}: Props) {
  const squareStyles: Record<string, CSSProperties> = {};
  // squareStyles land on a div inside the colored square, so a translucent
  // background tints the square and filter dims the piece on it.
  const highlight: CSSProperties = {
    backgroundColor: highlightColor ?? "rgba(255, 200, 0, 0.7)",
    boxShadow: "inset 0 0 0 4px rgba(255, 140, 0, 0.95)",
  };
  if (focus && focus.length > 0) {
    const lit = new Set(focus);
    for (const f of "abcdefgh") {
      for (let r = 1; r <= 8; r++) {
        const sq = `${f}${r}`;
        squareStyles[sq] = lit.has(sq)
          ? { boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.85)" }
          : { backgroundColor: "rgba(0,0,0,0.6)", filter: "brightness(0.45) saturate(0.4)" };
      }
    }
  }
  if (lastMove) {
    for (const sq of [lastMove.from, lastMove.to]) {
      squareStyles[sq] = { ...squareStyles[sq], backgroundColor: "rgba(110,231,167,0.35)" };
    }
  }
  for (const sq of highlightSquares ?? []) squareStyles[sq] = { ...squareStyles[sq], ...highlight };
  for (const sq of pulseSquares ?? []) {
    squareStyles[sq] = {
      ...squareStyles[sq],
      boxShadow: "inset 0 0 0 3px rgba(110,231,167,0.95)",
      animation: "pulse-ring 1.6s ease-out infinite",
    };
  }

  // The board grid is height:100%; in a stretched flex row that makes rows spread apart.
  // A square wrapper pins the height to the width.
  return (
    <div
      className="overflow-hidden rounded-card border border-line shadow-[0_20px_50px_-24px_rgba(0,0,0,0.8)]"
      style={{ aspectRatio: "1 / 1", width: "100%" }}
    >
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          arrows: arrows ?? [],
          squareStyles,
          allowDragging: onMove !== undefined,
          onSquareClick: onSquareClick ? ({ square }) => onSquareClick(square) : undefined,
          onPieceDrop: ({ sourceSquare, targetSquare }) =>
            onMove && targetSquare ? onMove(sourceSquare, targetSquare) : false,
        }}
      />
    </div>
  );
}
