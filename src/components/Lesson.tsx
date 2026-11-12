"use client";

import { useMemo, useState } from "react";
import GameViewer from "./GameViewer";
import MomentPanel, { type LadderEnd } from "./MomentPanel";
import type { MomentAnalysis } from "@/lib/engine/types";
import { enqueueMoment } from "@/lib/review/feed";
import type { GameContext } from "@/lib/coach/schema";
import { useGameAnalysis } from "@/lib/engine/useGameAnalysis";
import { parseMoves } from "@/lib/pgn";
import type { GameSummary } from "@/lib/types";

interface Props {
  game: GameSummary;
}

function moveLabel(ply: number, san: string): string {
  const n = Math.ceil(ply / 2);
  return `${n}.${ply % 2 === 0 ? ".." : ""} ${san}`;
}

/** One game: engine scan with a progress bar, then the 1-3 critical moments as tabs. */
export default function Lesson({ game }: Props) {
  const moves = useMemo(() => parseMoves(game.pgn).map((m) => m.san), [game.pgn]);
  const state = useGameAnalysis(game.id, moves, game.userColor);
  const [selected, setSelected] = useState(0);
  const [replay, setReplay] = useState(false);
  const [queued, setQueued] = useState<Record<number, boolean>>({});

  const ctx: GameContext = useMemo(
    () => ({
      white: game.white,
      black: game.black,
      userColor: game.userColor,
      result: game.result,
      timeClass: game.timeClass,
      opening: game.opening,
      moves,
    }),
    [game, moves],
  );
  const rating = game[game.userColor].rating;

  function onEnd(m: MomentAnalysis, end: LadderEnd) {
    // Found it cold: nothing to review. Any hint or a shown move -> queue it.
    if (end.solved && end.hintsTaken === 0) return;
    enqueueMoment({ id: `${game.id}-${m.ply}`, gameId: game.id, game: ctx, moment: m, rating }, end.motif);
    setQueued((q) => ({ ...q, [m.ply]: true }));
  }

  if (state.status === "idle" || state.status === "running") {
    const pct = state.status === "running" ? Math.round((100 * state.done) / state.total) : 0;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-zinc-300">Analysing with Stockfish in your browser...</p>
        <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-zinc-500">{pct}%</p>
      </div>
    );
  }
  if (state.status === "error") {
    return <p className="text-red-400">Engine failed: {state.message}</p>;
  }

  const moments = state.analysis.moments;
  const tab = "rounded px-3 py-1 text-sm";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {moments.map((m, i) => (
          <button
            key={m.ply}
            onClick={() => {
              setSelected(i);
              setReplay(false);
            }}
            className={`${tab} ${selected === i && !replay ? "bg-emerald-700 text-white" : "bg-zinc-800 hover:bg-zinc-700"}`}
          >
            Moment {i + 1}: {moveLabel(m.ply, m.played)}
            <span className="ml-2 text-xs opacity-70">-{(m.winProbBefore - m.winProbAfter).toFixed(0)}%</span>
          </button>
        ))}
        <button
          onClick={() => setReplay(true)}
          className={`${tab} ${replay ? "bg-emerald-700 text-white" : "bg-zinc-800 hover:bg-zinc-700"}`}
        >
          Replay game
        </button>
        {state.cached && <span className="text-xs text-zinc-500">cached analysis</span>}
      </div>

      {moments.length === 0 && !replay && (
        <p className="text-zinc-300">
          Clean game: no move of yours dropped the win chance by 10 points or more. Nothing to drill here. Pick another game or replay this one.
        </p>
      )}

      {replay ? (
        <GameViewer game={game} />
      ) : (
        moments[selected] && (
          <div className="flex flex-col gap-2">
            <MomentPanel
              key={moments[selected].ply}
              game={ctx}
              moment={moments[selected]}
              player={{ rating }}
              logBase={{ gameId: game.id }}
              onEnd={(end) => onEnd(moments[selected], end)}
            />
            {queued[moments[selected].ply] && (
              <p className="text-sm text-emerald-400">
                Added to your review queue. It comes back with less help.{" "}
                <a href="/review" className="underline">
                  Review
                </a>
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}
