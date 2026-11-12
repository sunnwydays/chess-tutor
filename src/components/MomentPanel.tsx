"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
import { logEvent, type LogEventInput } from "@/lib/log";
import { rungsFor, type LadderOutcome, type Level } from "@/lib/review/session";
import type { BoardArrow } from "./Board";

const Board = dynamic(() => import("./Board"), { ssr: false });

interface Exchange {
  stage: Stage;
  attempt?: string;
  response: CoachResponse;
}

export interface LadderEnd extends LadderOutcome {
  /** Coach's motif tag for the moment (idea tag fallback when unlabelled). */
  motif: string;
}

interface Props {
  game: GameContext;
  moment: MomentAnalysis;
  player: PlayerContext;
  /** Assistance level (spaced repetition dial). 5 and 4 = full ladder; lessons use 5. */
  level?: Level;
  mode?: "lesson" | "review";
  /** Extra fields on every log row (gameId, reviewItemId, positionKind, virtualClock). */
  logBase?: Partial<LogEventInput>;
  /** Fires once: a good/best attempt (solved) or the move shown (not solved). */
  onEnd?: (end: LadderEnd) => void;
  /** Review: hide what was played and the win-chance drop (that is a hint). */
  hideResult?: boolean;
  /** Level 5: the moves that led here, shown above the board. */
  context?: string;
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

const HINT_STAGES: Stage[] = ["focus", "threat", "piece", "move", "explain"];

export default function MomentPanel({ game, moment, player, level = 5, mode = "lesson", logBase, onEnd, hideResult, context }: Props) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const startedAt = useRef(Date.now());
  const firstAttemptMs = useRef<number | null>(null);
  const ended = useRef(false);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const taken = (s: Stage) => exchanges.some((e) => e.stage === s);
  const allowed = rungsFor(level);
  const hintsIn = (xs: Exchange[]) => xs.filter((e) => HINT_STAGES.includes(e.stage)).length;

  function log(row: Partial<LogEventInput>) {
    logEvent({ mode, ply: moment.ply, level, ...logBase, ...row });
  }
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
      const next = [...exchanges, { stage, attempt, response: data }];
      setExchanges(next);
      const hintsTaken = hintsIn(next);
      const validationResult = data.source === "fallback" ? "fallback" : data.errors?.length ? "regenerated" : "ok";
      log({
        stage,
        attempt,
        verdict: data.attemptVerdict ?? undefined,
        hintsTaken,
        msToFirstAttempt: firstAttemptMs.current ?? undefined,
        validationResult,
      });
      const solved = stage === "attempt" && (data.attemptVerdict === "best" || data.attemptVerdict === "good");
      if (!ended.current && (solved || stage === "move")) {
        ended.current = true;
        const end: LadderEnd = {
          solved,
          hintsTaken,
          msToFirstAttempt: firstAttemptMs.current ?? 0,
          motif: next.map((e) => e.response.reply.motif).filter(Boolean).pop() ?? "",
        };
        log({ stage: "end", verdict: solved ? "solved" : "shown", hintsTaken, msToFirstAttempt: end.msToFirstAttempt });
        onEnd?.(end);
      }
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
    if (firstAttemptMs.current === null) firstAttemptMs.current = Date.now() - startedAt.current;
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
          {context && <p className="text-sm text-zinc-400">Leading up to it: {context}</p>}
          {(!hideResult || ended.current) && (
            <p className="text-sm text-zinc-500">
              You played {moment.played} ({moment.winProbBefore.toFixed(0)}% -&gt;{" "}
              {moment.winProbAfter.toFixed(0)}% win chance)
            </p>
          )}
          {level < 4 && (
            <p className="text-xs text-zinc-500">
              {level === 3 ? "Hints up to the piece." : "No hints this time: one try, or show the answer."}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RUNGS.filter((r) => allowed.includes(r.stage) || (r.stage === "explain" && taken("move"))).map((r) => (
            <button
              key={r.stage}
              className={btn}
              disabled={loading || taken(r.stage) || !taken(r.needs)}
              onClick={() => void send(r.stage)}
            >
              {r.label}
            </button>
          ))}
          <button
            className="text-sm text-zinc-400 underline hover:text-zinc-200 disabled:opacity-40 disabled:no-underline"
            disabled={loading || !taken("attempt") || taken("move")}
            onClick={() => void send("move")}
          >
            {allowed.includes("move") ? "Skip to the move" : "Show the answer"}
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
