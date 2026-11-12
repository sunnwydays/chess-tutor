"use client";

import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseMoves } from "@/lib/pgn";
import type { GameSummary } from "@/lib/types";
import { Button, Card, Kbd, cx } from "./ui";

const Board = dynamic(() => import("./Board"), { ssr: false });

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface Props {
  game: GameSummary;
}

/** from/to per ply, by replaying the PGN (parseMoves only keeps SAN + FEN). */
function squaresPerPly(pgn: string): { from: string; to: string }[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to }));
}

export default function GameViewer({ game }: Props) {
  const moves = useMemo(() => parseMoves(game.pgn), [game.pgn]);
  const squares = useMemo(() => squaresPerPly(game.pgn), [game.pgn]);
  const [ply, setPly] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const last = moves.length;
  const go = (n: number) => setPly(Math.max(0, Math.min(last, n)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPly((p) => Math.min(last, p + 1));
      else if (e.key === "Home") setPly(0);
      else if (e.key === "End") setPly(last);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [ply]);

  const fen = ply === 0 ? START_FEN : moves[ply - 1].fen;
  const lastMove = ply === 0 ? undefined : squares[ply - 1];

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="w-full lg:w-[560px] lg:shrink-0">
        <Board fen={fen} orientation={game.userColor} lastMove={lastMove} />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" disabled={ply === 0} onClick={() => go(0)}>
            &laquo; First
          </Button>
          <Button size="sm" disabled={ply === 0} onClick={() => go(ply - 1)}>
            &lsaquo; Prev
          </Button>
          <Button size="sm" disabled={ply === last} onClick={() => go(ply + 1)}>
            Next &rsaquo;
          </Button>
          <Button size="sm" disabled={ply === last} onClick={() => go(last)}>
            Last &raquo;
          </Button>
          <span className="ml-1 hidden items-center gap-1 text-xs text-muted sm:flex">
            <Kbd>&larr;</Kbd>
            <Kbd>&rarr;</Kbd>
          </span>
        </div>
      </div>
      <Card className="max-h-[560px] min-w-0 flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-y-0.5 font-mono text-sm">
          {Array.from({ length: Math.ceil(last / 2) }, (_, i) => (
            <div key={i} className="contents">
              <span className="px-2 py-1 text-muted">{i + 1}.</span>
              {[2 * i, 2 * i + 1].map((idx) =>
                idx < last ? (
                  <button
                    key={idx}
                    ref={ply === idx + 1 ? activeRef : undefined}
                    onClick={() => go(idx + 1)}
                    className={cx(
                      "rounded-md px-2 py-1 text-left transition-colors",
                      ply === idx + 1 ? "bg-accent text-accent-ink" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {moves[idx].san}
                  </button>
                ) : (
                  <span key={idx} />
                ),
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
