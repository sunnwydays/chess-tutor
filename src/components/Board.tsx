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
  onMove?: (from: string, to: string) => boolean;
}

const HIGHLIGHT: CSSProperties = { backgroundColor: "rgba(255, 213, 0, 0.45)" };

export default function Board({ fen, orientation, arrows, highlightSquares, onMove }: Props) {
  const squareStyles: Record<string, CSSProperties> = {};
  for (const sq of highlightSquares ?? []) squareStyles[sq] = HIGHLIGHT;

  return (
    <Chessboard
      options={{
        position: fen,
        boardOrientation: orientation,
        arrows: arrows ?? [],
        squareStyles,
        allowDragging: onMove !== undefined,
        onPieceDrop: ({ sourceSquare, targetSquare }) =>
          onMove && targetSquare ? onMove(sourceSquare, targetSquare) : false,
      }}
    />
  );
}
