"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { parseMoves } from "@/lib/pgn";
import type { GameSummary } from "@/lib/types";

const Board = dynamic(() => import("./Board"), { ssr: false });

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface Props {
  game: GameSummary;
}

export default function GameViewer({ game }: Props) {
  const moves = useMemo(() => parseMoves(game.pgn), [game.pgn]);
  const [ply, setPly] = useState(0);

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

  const fen = ply === 0 ? START_FEN : moves[ply - 1].fen;
  const btn = "rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="w-full max-w-[520px]">
        <Board fen={fen} orientation={game.userColor} />
        <div className="mt-3 flex justify-center gap-2">
          <button className={btn} disabled={ply === 0} onClick={() => go(0)}>
            First
          </button>
          <button className={btn} disabled={ply === 0} onClick={() => go(ply - 1)}>
            Prev
          </button>
          <button className={btn} disabled={ply === last} onClick={() => go(ply + 1)}>
            Next
          </button>
          <button className={btn} disabled={ply === last} onClick={() => go(last)}>
            Last
          </button>
        </div>
      </div>
      <div className="max-h-[520px] flex-1 overflow-y-auto rounded border border-zinc-800 p-2">
        <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-y-1 text-sm">
          {Array.from({ length: Math.ceil(last / 2) }, (_, i) => (
            <div key={i} className="contents">
              <span className="text-zinc-500">{i + 1}.</span>
              {[2 * i, 2 * i + 1].map((idx) =>
                idx < last ? (
                  <button
                    key={idx}
                    onClick={() => go(idx + 1)}
                    className={`rounded px-2 py-0.5 text-left hover:bg-zinc-800 ${
                      ply === idx + 1 ? "bg-emerald-700 text-white" : ""
                    }`}
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
      </div>
    </div>
  );
}
