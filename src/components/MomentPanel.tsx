"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Chess } from "chess.js";
import type { MomentAnalysis } from "@/lib/engine/types";
import type {
  AttemptVerdict,
  CoachRequest,
  CoachResponse,
  CoachTurn,
  GameContext,
  PlayerContext,
  Stage,
} from "@/lib/coach/schema";
import type { BoardArrow } from "./Board";

const Board = dynamic(() => import("./Board"), { ssr: false });

interface Exchange {
  stage: Stage;
  attempt?: string;
  response: CoachResponse;
}

interface Props {
  game: GameContext;
  moment: MomentAnalysis;
  player: PlayerContext;
}

const VERDICTS: Record<AttemptVerdict, { label: string; cls: string }> = {
  best: { label: "Best move", cls: "bg-emerald-700 text-white" },
  good: { label: "Good move", cls: "bg-teal-700 text-white" },
  inaccuracy: { label: "Inaccuracy", cls: "bg-amber-600 text-white" },
  mistake: { label: "Mistake", cls: "bg-red-700 text-white" },
  unknown: { label: "Not analysed", cls: "bg-zinc-700 text-zinc-200" },
};

const RUNGS: { stage: Stage; label: string; needs: Stage }[] = [
  { stage: "focus", label: "Where to look", needs: "attempt" },
  { stage: "threat", label: "What they threaten", needs: "focus" },
  { stage: "piece", label: "Which piece", needs: "threat" },
  { stage: "move", label: "Show the move", needs: "piece" },
  { stage: "explain", label: "Explain", needs: "move" },
];

const STAGE_LABEL: Record<Stage, string> = {
  attempt: "Attempt",
  focus: "Where to look",
  threat: "What they threaten",
  piece: "Which piece",
  move: "Move",
  explain: "Explain",
};

const ARROW_COLOR = { threat: "rgba(239,68,68,0.8)", move: "rgba(34,197,94,0.8)" } as const;

export default function MomentPanel({ game, moment, player }: Props) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);

  const taken = (s: Stage) => exchanges.some((e) => e.stage === s);
  const latest = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;

  async function send(stage: Stage, attempt?: string) {
    setLoading(true);
    setError(null);
    const history: CoachTurn[] = exchanges.map((e) => ({
      stage: e.stage,
      ...(e.attempt ? { attempt: e.attempt } : {}),
      text: e.response.reply.text,
    }));
    const body: CoachRequest = { game, moment, player, stage, history, ...(attempt ? { attempt } : {}) };
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as CoachResponse | { error: string };
      if (!res.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Request failed");
      }
      setExchanges((prev) => [...prev, { stage, attempt, response: data }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
      setBoardKey((k) => k + 1);
    }
  }

  function onMove(from: string, to: string): boolean {
    if (loading) return false;
    let san: string;
    try {
      san = new Chess(moment.fenBefore).move({ from, to, promotion: "q" }).san;
    } catch {
      return false;
    }
    void send("attempt", san);
    return true;
  }

  const arrows: BoardArrow[] = (latest?.response.reply.arrows ?? []).map((a) => ({
    startSquare: a.from,
    endSquare: a.to,
    color: ARROW_COLOR[a.kind] ?? ARROW_COLOR.move,
  }));
  // Tunnel vision: the focus zone stays lit (rest faded) through the threat rung.
  const focusEx = exchanges.find((e) => e.stage === "focus");
  const focus = focusEx && (latest?.stage === "focus" || latest?.stage === "threat") ? focusEx.response.reply.squares : undefined;
  const motif = latest?.response.reply.motif ?? "";
  const showMotif = taken("attempt") && motif.trim() !== "";
  const explained = taken("explain");
  const top = moment.lines[0];

  const n = Math.ceil(moment.ply / 2);
  const dots = moment.ply % 2 === 0 ? "..." : ".";
  const btn = "rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700 disabled:opacity-40";
  const chip = "rounded px-2 py-0.5 text-xs";

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="w-full max-w-[520px]">
        <Board
          key={boardKey}
          fen={moment.fenBefore}
          orientation={game.userColor}
          arrows={arrows}
          highlightSquares={latest?.stage === "focus" ? [] : (latest?.response.reply.squares ?? [])}
          focus={focus}
          onMove={onMove}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h2 className="text-lg font-medium">
            Move {n}
            {dots} — what would you play?
          </h2>
          <p className="text-sm text-zinc-500">
            You played {moment.played} ({moment.winProbBefore.toFixed(0)}% -&gt;{" "}
            {moment.winProbAfter.toFixed(0)}% win chance)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RUNGS.map((r) => (
            <button
              key={r.stage}
              className={btn}
              disabled={loading || !taken(r.needs)}
              onClick={() => void send(r.stage)}
            >
              {r.label}
            </button>
          ))}
          <button
            className="text-sm text-zinc-400 underline hover:text-zinc-200 disabled:opacity-40 disabled:no-underline"
            disabled={loading || !taken("attempt")}
            onClick={() => void send("move")}
          >
            Skip to the move
          </button>
        </div>

        {showMotif && (
          <div>
            <span className={`${chip} bg-zinc-800 text-zinc-300`}>Motif: {motif}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {exchanges.map((e, i) => {
            const verdict = e.response.attemptVerdict ? VERDICTS[e.response.attemptVerdict] : null;
            return (
              <div key={i} className="rounded border border-zinc-800 p-3 text-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`${chip} bg-zinc-800 text-zinc-300`}>
                    {e.stage === "attempt" ? `Attempt ${e.attempt ?? ""}` : STAGE_LABEL[e.stage]}
                  </span>
                  {e.stage === "attempt" && verdict && (
                    <span className={`${chip} ${verdict.cls}`}>{verdict.label}</span>
                  )}
                  {e.response.source === "fallback" && (
                    <span className="text-xs text-zinc-500">engine-only reply</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{e.response.reply.text}</p>
              </div>
            );
          })}
          {loading && <p className="text-sm text-zinc-400">Coach is thinking...</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {explained && top && (
          <div className="rounded bg-zinc-900 p-3">
            <div className="mb-1 text-xs text-zinc-500">Engine line</div>
            <div className="font-mono text-xs text-zinc-400">
              {(top.evalCp / 100).toFixed(2)} {top.pv.join(" ")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
