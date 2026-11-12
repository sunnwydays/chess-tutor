"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import { logEvent, type LogEventInput } from "@/lib/log";
import { gradeStreamPick, type Stream, type StreamGrade, type StreamPick } from "@/lib/review/streams";
import type { BoardArrow } from "./Board";
import { Button, Card, Chip, Eyebrow, cx } from "./ui";

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

const GRADE_UI: Record<StreamGrade, { label: string; tone: "accent" | "amber" | "danger" }> = {
  correct: { label: "Correct", tone: "accent" },
  "missing-details": { label: "Close", tone: "amber" },
  incorrect: { label: "Not this time", tone: "danger" },
};

interface Step {
  fen: string;
  arrow?: BoardArrow;
  last?: { from: string; to: string };
}

/**
 * Form B (level 0): step through a few moves with no eval and stop on the
 * move you'd take back, or say nothing went wrong. Graded in code.
 */
export default function FindMoment({ stream, logBase, onDone }: Props) {
  const steps = useMemo(() => {
    const chess = new Chess(stream.startFen);
    const out: Step[] = [{ fen: chess.fen() }];
    for (const p of stream.plies) {
      const mv = chess.move(p.san);
      out.push({
        fen: chess.fen(),
        arrow: { startSquare: mv.from, endSquare: mv.to, color: "rgba(245,158,11,0.8)" },
        last: { from: mv.from, to: mv.to },
      });
    }
    return out;
  }, [stream]);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<StreamPick | null>(null);
  const [startedAt] = useState(() => Date.now());

  const grade = pick === null ? null : gradeStreamPick(stream, pick);
  const atEnd = i === stream.plies.length;

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
  const step = steps[i];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="w-full lg:w-[560px] lg:shrink-0">
        <Board
          fen={step.fen}
          orientation={stream.userColor}
          arrows={step.arrow ? [step.arrow] : []}
          lastMove={step.last}
        />
        <div className="mt-3 flex justify-center gap-2">
          <Button size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>
            &lsaquo; Prev
          </Button>
          <Button size="sm" disabled={atEnd} onClick={() => setI(i + 1)}>
            Next move &rsaquo;
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Review exercise</Eyebrow>
          <h2 className="text-xl font-semibold text-fg">Find the moment</h2>
          <p className="text-sm text-fg-2">
            Step through these moves from one of your games. If one of <b className="text-fg">your</b> moves was a mistake, click it. If nothing went wrong, say so.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 font-mono text-sm">
          {stream.plies.slice(0, i).map((p) => {
            const picked = pick === p.ply;
            const isAnswer = pick !== null && p.ply === stream.answerPly;
            return p.selectable ? (
              <button
                key={p.ply}
                disabled={pick !== null}
                onClick={() => choose(p.ply)}
                className={cx(
                  "rounded-lg border px-2.5 py-1 transition-colors",
                  isAnswer
                    ? "border-accent bg-accent/15 text-accent"
                    : picked
                      ? "border-danger bg-danger/15 text-danger"
                      : "border-line-strong bg-surface-2 text-fg hover:border-accent/60 hover:bg-surface-3 disabled:opacity-60",
                )}
              >
                {label(p.ply, p.san)}
              </button>
            ) : (
              <span key={p.ply} className="px-2.5 py-1 text-muted">
                {label(p.ply, p.san)}
              </span>
            );
          })}
        </div>
        {pick === null && (
          <Button className="self-start" disabled={!atEnd} onClick={() => choose("none")}>
            {atEnd ? "Nothing wrong here" : "Step to the end to say nothing went wrong"}
          </Button>
        )}
        {grade && (
          <Card className="flex flex-col gap-3 p-4 text-sm">
            <Chip tone={GRADE_UI[grade].tone} className="self-start">
              {GRADE_UI[grade].label}
            </Chip>
            <p className="text-fg-2">
              {answer
                ? `The moment was ${label(answer.ply, answer.san)} (your win chance dropped ${stream.swing.toFixed(0)} points).`
                : "Nothing here dropped your win chance by more than a few points."}
            </p>
            <Button variant="primary" className="self-start" onClick={() => onDone(grade, pick!)}>
              {answer ? "Find the better move" : "Next"}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
