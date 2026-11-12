"use client";

import { useMemo, useState } from "react";
import GameViewer from "./GameViewer";
import MomentPanel, { type LadderEnd } from "./MomentPanel";
import type { MomentAnalysis } from "@/lib/engine/types";
import { enqueueMoment } from "@/lib/review/feed";
import type { GameContext } from "@/lib/coach/schema";
import { useGameAnalysis } from "@/lib/engine/useGameAnalysis";
import { who } from "@/lib/me";
import { parseMoves } from "@/lib/pgn";
import type { GameSummary } from "@/lib/types";
import { Button, Card, Chip, Eyebrow, ProgressBar, Reveal, cx } from "./ui";

interface Props {
  game: GameSummary;
  me: boolean;
  nextGame?: GameSummary | null;
  onOpenGame?: (g: GameSummary) => void;
}

/** Move number only: naming the played move would give the moment away. */
function moveLabel(ply: number): string {
  const n = Math.ceil(ply / 2);
  return `${n}${ply % 2 === 0 ? "..." : ""}`;
}

function opponentName(g: GameSummary): string {
  return g[g.userColor === "white" ? "black" : "white"].username;
}

/** One game: engine scan with progress, then the 1-3 critical moments as a segmented control. */
export default function Lesson({ game, me, nextGame, onOpenGame }: Props) {
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
  const w = who(me);

  function onEnd(m: MomentAnalysis, end: LadderEnd) {
    // Found it cold: nothing to review. Any hint or a shown move -> queue it.
    if (end.solved && end.hintsTaken === 0) return;
    enqueueMoment({ id: `${game.id}-${m.ply}`, gameId: game.id, game: ctx, moment: m, rating }, end.motif);
    setQueued((q) => ({ ...q, [m.ply]: true }));
  }

  if (state.status === "idle" || state.status === "running") {
    const done = state.status === "running" ? state.done : 0;
    const total = state.status === "running" ? state.total : moves.length;
    const pct = total > 0 ? Math.round((100 * done) / total) : 0;
    const scanned = total > 0 && done >= total - 1;
    const stages = [
      { label: "Scan every move at depth 10", done: scanned },
      { label: `Find the biggest swings in ${w.possessive} moves`, done: scanned && pct >= 100 },
      { label: "Deep-search the critical positions (MultiPV)", done: false },
    ];
    const activeIdx = stages.findIndex((s) => !s.done);
    return (
      <Reveal>
        <Card className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <Eyebrow>Analysing</Eyebrow>
              <h2 className="text-xl font-semibold text-fg">Stockfish is scanning the game</h2>
              <p className="text-sm text-muted">Runs in your browser; nothing is uploaded.</p>
            </div>
            <span className="relative mt-1 flex size-3 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
              <span className="relative inline-flex size-3 rounded-full bg-accent" />
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <ProgressBar value={pct} className="h-3" />
            <div className="flex justify-between font-mono text-xs text-muted">
              <span>
                {done} / {total} moves
              </span>
              <span>{pct}%</span>
            </div>
          </div>
          <ul className="flex flex-col gap-2.5 text-sm">
            {stages.map((st, i) => (
              <li
                key={st.label}
                className={cx(
                  "flex items-center gap-2.5",
                  st.done ? "text-fg-2" : i === activeIdx ? "text-fg" : "text-muted",
                )}
              >
                <span
                  className={cx(
                    "flex size-4 items-center justify-center rounded-full border text-[10px] leading-none",
                    st.done
                      ? "border-accent bg-accent text-accent-ink"
                      : i === activeIdx
                        ? "animate-pulse border-accent/60"
                        : "border-line-strong",
                  )}
                  aria-hidden
                >
                  {st.done ? "✓" : ""}
                </span>
                {st.label}
              </li>
            ))}
          </ul>
        </Card>
      </Reveal>
    );
  }
  if (state.status === "error") {
    return <p className="text-danger">Engine failed: {state.message}</p>;
  }

  const moments = state.analysis.moments;
  const current = moments[selected];
  const pill = "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm transition-colors";
  const pillOn = "bg-surface-3 text-fg shadow";
  const pillOff = "text-fg-2 hover:text-fg";
  const contentKey = replay ? "replay" : `m${current?.ply ?? "none"}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
          {moments.map((m, i) => (
            <button
              key={m.ply}
              onClick={() => {
                setSelected(i);
                setReplay(false);
              }}
              className={cx(pill, selected === i && !replay ? pillOn : pillOff)}
            >
              Moment {i + 1} · move {moveLabel(m.ply)}
              <span className="font-mono text-xs text-danger">-{(m.winProbBefore - m.winProbAfter).toFixed(0)}%</span>
            </button>
          ))}
          <button onClick={() => setReplay(true)} className={cx(pill, replay ? pillOn : pillOff)}>
            Replay game
          </button>
        </div>
        {state.cached && <Chip tone="neutral">cached analysis</Chip>}
      </div>

      <Reveal key={contentKey}>
        {replay ? (
          <GameViewer game={game} />
        ) : current ? (
          <div className="flex flex-col gap-4">
            <MomentPanel
              key={current.ply}
              game={ctx}
              moment={current}
              player={{ rating }}
              logBase={{ gameId: game.id }}
              me={me}
              leadUp
              onEnd={(end) => onEnd(current, end)}
            />
            {queued[current.ply] && (
              <Reveal>
                <div className="flex flex-wrap items-center gap-3">
                  <Chip tone="accent">Added to review</Chip>
                  <span className="text-sm text-fg-2">It comes back later with less help.</span>
                  <a href="/review">
                    <Button variant="ghost" size="sm" tabIndex={-1}>
                      Open review
                    </Button>
                  </a>
                </div>
              </Reveal>
            )}
          </div>
        ) : (
          <Card className="flex flex-col gap-5 p-6 sm:p-8">
            <div className="flex flex-col gap-1.5">
              <Eyebrow>Clean game</Eyebrow>
              <h2 className="text-xl font-semibold text-fg">
                {w.Subject} never dropped the win chance by 10 points or more.
              </h2>
              <p className="max-w-prose text-sm text-fg-2">
                Nothing to drill here. The fastest way to improve is to find a game that did have a turning point.
              </p>
            </div>
            {nextGame ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => onOpenGame?.(nextGame)}>
                  Try the next game: vs {opponentName(nextGame)} ({nextGame.result})
                </Button>
                <Button onClick={() => setReplay(true)}>Replay this game</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted">That was the last game in the list. Pick another one above.</p>
                <Button onClick={() => setReplay(true)}>Replay this game</Button>
              </div>
            )}
          </Card>
        )}
      </Reveal>
    </div>
  );
}
