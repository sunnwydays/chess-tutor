"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { logEvent, type LogEventInput } from "@/lib/log";
import { gradeStreamPick, type Stream, type StreamGrade, type StreamPick } from "@/lib/review/streams";
import type { BoardArrow } from "./Board";

const Board = dynamic(() => import("./Board"), { ssr: false });

interface Props {
  stream: Stream;
  logBase: Partial<LogEventInput>;
  onDone: (grade: StreamGrade, pick: StreamPick) => void;
}

function label(ply: number, san: string): string {
  const n = Math.ceil(ply / 2);
  return `${n}.${ply % 2 === 0 ? ".." : ""} ${san}`;
}

const GRADE_UI: Record<StreamGrade, { label: string; cls: string }> = {
  correct: { label: "Correct", cls: "bg-emerald-700 text-white" },
  "missing-details": { label: "Close", cls: "bg-amber-600 text-white" },
  incorrect: { label: "Not this time", cls: "bg-red-700 text-white" },
};

/**
 * Form B (level 0): step through a few moves with no eval and stop on the
 * move you'd take back, or say nothing went wrong. Graded in code.
 */
export default function FindMoment({ stream, logBase, onDone }: Props) {
  const steps = useMemo(() => {
    const chess = new Chess(stream.startFen);
    const out: { fen: string; arrow?: BoardArrow }[] = [{ fen: chess.fen() }];
    for (const p of stream.plies) {
      const mv = chess.move(p.san);
      out.push({ fen: chess.fen(), arrow: { startSquare: mv.from, endSquare: mv.to, color: "rgba(245,158,11,0.8)" } });
    }
    return out;
  }, [stream]);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<StreamPick | null>(null);
  const [startedAt] = useState(() => Date.now());

  const grade = pick === null ? null : gradeStreamPick(stream, pick);
  const atEnd = i === stream.plies.length;
  const btn = "rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:opacity-40";

  function choose(p: StreamPick) {
    setPick(p);
    logEvent({
      mode: "review",
      stage: "find-moment",
      level: 0,
      attempt: String(p),
      verdict: gradeStreamPick(stream, p),
      msToFirstAttempt: Date.now() - startedAt,
      ...logBase,
      extra: { streamId: stream.id, kind: stream.kind, answerPly: stream.answerPly },
    });
  }

  const answer = stream.answerPly ? stream.plies.find((p) => p.ply === stream.answerPly) : null;

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="w-full max-w-[520px]">
        <Board fen={steps[i].fen} orientation={stream.userColor} arrows={steps[i].arrow ? [steps[i].arrow!] : []} />
        <div className="mt-3 flex justify-center gap-2">
          <button className={btn} disabled={i === 0} onClick={() => setI(i - 1)}>
            Prev
          </button>
          <button className={btn} disabled={atEnd} onClick={() => setI(i + 1)}>
            Next move
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="text-lg font-medium">Find the moment</h2>
        <p className="text-sm text-zinc-400">
          Step through these moves from one of your games. If one of <b>your</b> moves was a mistake, click it. If nothing went wrong, say so.
        </p>
        <div className="flex flex-wrap gap-1 text-sm">
          {stream.plies.slice(0, i).map((p) => {
            const picked = pick === p.ply;
            const isAnswer = pick !== null && p.ply === stream.answerPly;
            return p.selectable ? (
              <button
                key={p.ply}
                disabled={pick !== null}
                onClick={() => choose(p.ply)}
                className={`rounded border px-2 py-0.5 ${isAnswer ? "border-emerald-500" : picked ? "border-red-500" : "border-zinc-600 hover:bg-zinc-800"}`}
              >
                {label(p.ply, p.san)}
              </button>
            ) : (
              <span key={p.ply} className="px-2 py-0.5 text-zinc-500">
                {label(p.ply, p.san)}
              </span>
            );
          })}
        </div>
        {pick === null && (
          <button className={`${btn} self-start`} disabled={!atEnd} onClick={() => choose("none")}>
            {atEnd ? "Nothing wrong here" : "Step to the end to say nothing went wrong"}
          </button>
        )}
        {grade && (
          <div className="rounded border border-zinc-800 p-3 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs ${GRADE_UI[grade].cls}`}>{GRADE_UI[grade].label}</span>
            <p className="mt-2 text-zinc-300">
              {answer
                ? `The moment was ${label(answer.ply, answer.san)} (your win chance dropped ${stream.swing.toFixed(0)} points).`
                : "Nothing here dropped your win chance by more than a few points."}
            </p>
            <button
              className="mt-2 rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600"
              onClick={() => onDone(grade, pick!)}
            >
              {answer ? "Find the better move" : "Next"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
