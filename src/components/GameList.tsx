"use client";

import { Card, Chip, Reveal, cx } from "@/components/ui";
import type { GameSummary } from "@/lib/types";

interface Props {
  games: GameSummary[];
  onSelect: (game: GameSummary) => void;
}

const RESULT: Record<GameSummary["result"], { dot: string; text: string; label: string }> = {
  win: { dot: "bg-accent", text: "text-accent", label: "Win" },
  loss: { dot: "bg-danger", text: "text-danger", label: "Loss" },
  draw: { dot: "bg-muted", text: "text-muted", label: "Draw" },
};

export default function GameList({ games, onSelect }: Props) {
  if (games.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted">No recent games found for this player.</Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {games.map((g, i) => {
          const opp = g.userColor === "white" ? g.black : g.white;
          const r = RESULT[g.result];
          return (
            <li key={g.id}>
              <Reveal delay={Math.min(i, 12) * 30}>
                <button
                  onClick={() => onSelect(g)}
                  className="group grid w-full grid-cols-[4.5rem_1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none sm:grid-cols-[4.5rem_5.5rem_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
                >
                  <span className={cx("flex items-center gap-2 text-sm font-medium", r.text)}>
                    <span className={cx("size-2 rounded-full", r.dot)} />
                    {r.label}
                  </span>
                  <span className="hidden sm:block">
                    <Chip className="capitalize">{g.timeClass}</Chip>
                  </span>
                  <span className="min-w-0 truncate text-sm text-fg">
                    {opp.username}
                    <span className="ml-1.5 font-mono text-[12px] tabular-nums text-muted">{opp.rating}</span>
                  </span>
                  <span className="hidden min-w-0 truncate text-[13px] text-muted sm:block">
                    {g.opening ?? ""}
                  </span>
                  <span className="flex items-center gap-3 justify-self-end">
                    <span className="font-mono text-[12px] tabular-nums text-muted">
                      {new Date(g.endTime * 1000).toLocaleDateString()}
                    </span>
                    <span
                      aria-hidden
                      className="text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg"
                    >
                      &rsaquo;
                    </span>
                  </span>
                </button>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
