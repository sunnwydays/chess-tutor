"use client";

import type { CSSProperties } from "react";
import { Chessboard } from "react-chessboard";

export interface BoardArrow {
  startSquare: string;
  endSquare: string;
  color: string;
}

interface Props {
  fen: string;
  orientation: "white" | "black";
  arrows?: BoardArrow[];
  highlightSquares?: string[];
  /** CSS color for highlightSquares; default soft yellow. */
  highlightColor?: string;
  onMove?: (from: string, to: string) => boolean;
  onSquareClick?: (square: string) => void;
}

export default function Board({ fen, orientation, arrows, highlightSquares, highlightColor, onMove, onSquareClick }: Props) {
  const squareStyles: Record<string, CSSProperties> = {};
  const highlight: CSSProperties = {
    backgroundColor: highlightColor ?? "rgba(255, 213, 0, 0.45)",
    boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.6)",
  };
  for (const sq of highlightSquares ?? []) squareStyles[sq] = highlight;

  // The board grid is height:100%; in a stretched flex row that makes rows spread apart.
  // A square wrapper pins the height to the width.
  return (
    <div style={{ aspectRatio: "1 / 1", width: "100%" }}>
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
