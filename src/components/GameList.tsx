"use client";

import type { GameSummary } from "@/lib/types";

interface Props {
  games: GameSummary[];
  onSelect: (game: GameSummary) => void;
}

const RESULT_STYLE: Record<GameSummary["result"], string> = {
  win: "text-emerald-400",
  loss: "text-red-400",
  draw: "text-zinc-400",
};

export default function GameList({ games, onSelect }: Props) {
  if (games.length === 0) {
    return <p className="text-zinc-400">No recent games found.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
      {games.map((g) => {
        const opp = g.userColor === "white" ? g.black : g.white;
        return (
          <li key={g.id}>
            <button
              onClick={() => onSelect(g)}
              className="grid w-full grid-cols-[6rem_5rem_1fr_4rem] items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900"
            >
              <span className="text-sm text-zinc-400">
                {new Date(g.endTime * 1000).toLocaleDateString()}
              </span>
              <span className="text-sm capitalize">{g.timeClass}</span>
              <span className="truncate">
                vs {opp.username} ({opp.rating})
                {g.opening && <span className="ml-2 text-xs text-zinc-500">{g.opening}</span>}
              </span>
              <span className={`text-right font-medium uppercase ${RESULT_STYLE[g.result]}`}>
                {g.result}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
