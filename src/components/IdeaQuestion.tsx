"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { logEvent, type LogEventInput } from "@/lib/log";
import type { RubricGrade, RubricLabel, RubricScores } from "@/lib/review/rubric";
import { Button, Card, Chip, Eyebrow } from "./ui";

const Board = dynamic(() => import("./Board"), { ssr: false });

interface Props {
  fen: string;
  orientation: "white" | "black";
  label: RubricLabel;
  logBase: Partial<LogEventInput>;
  /** Final grade after at most one follow-up, or null if grading failed. */
  onDone: (grade: RubricGrade | null) => void;
}

interface GradeResponse {
  grade: RubricGrade;
  scores: RubricScores;
  followUp: string | null;
}

const GRADE_UI: Record<RubricGrade, { label: string; tone: "accent" | "amber" | "danger" }> = {
  correct: { label: "Correct", tone: "accent" },
  "missing-details": { label: "Missing details", tone: "amber" },
  incorrect: { label: "Not quite", tone: "danger" },
};

/**
 * Form A (level 1): explain the idea in a line, no move. Haiku extracts the
 * claims, code grades them against the /label ground truth. One follow-up
 * question on the weakest part, then the ladder.
 */
export default function IdeaQuestion({ fen, orientation, label, logBase, onDone }: Props) {
  const [answer, setAnswer] = useState("");
  const [turns, setTurns] = useState<{ answer: string; res: GradeResponse }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const last = turns[turns.length - 1];
  const finished = !!last && (turns.length === 2 || !last.res.followUp);

  async function submit() {
    if (!answer.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/review/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, fen, label, first: turns[0]?.res.grade }),
      });
      const data = (await res.json()) as GradeResponse | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Request failed");
      logEvent({
        mode: "review",
        stage: turns.length ? "idea-followup" : "idea",
        level: 1,
        attempt: answer,
        verdict: data.grade,
        ...logBase,
        extra: { scores: data.scores },
      });
      setTurns((t) => [...t, { answer, res: data }]);
      setAnswer("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const question = turns.length === 0 ? "What's the plan here? In a line: the idea, where on the board, and what your opponent is up to." : last.res.followUp;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="w-full lg:w-[560px] lg:shrink-0">
        <Board fen={fen} orientation={orientation} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Review exercise</Eyebrow>
          <h2 className="text-xl font-semibold text-fg">Explain the idea</h2>
          <p className="text-sm text-muted">No move this time. Words only; the board comes after.</p>
        </div>

        {turns.map((t, i) => (
          <Card key={i} className="flex flex-col gap-2 p-4 text-sm">
            <p className="text-fg-2">&ldquo;{t.answer}&rdquo;</p>
            <Chip tone={GRADE_UI[t.res.grade].tone} className="self-start">
              {GRADE_UI[t.res.grade].label}
            </Chip>
          </Card>
        ))}

        {!finished && (
          <>
            <p className="text-sm text-fg">{question}</p>
            <textarea
              className="min-h-[5rem] rounded-xl border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-60"
              placeholder="e.g. trade off the defender of e5, then my queen hits g7"
              value={answer}
              maxLength={600}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={loading}
            />
            <Button variant="primary" className="self-start" disabled={loading || !answer.trim()} onClick={() => void submit()}>
              {loading ? "Grading..." : "Submit"}
            </Button>
          </>
        )}
        {error && (
          <div className="flex flex-col gap-3 text-sm text-danger">
            {error}
            {(label.idea || label.opponentMotif) && (
              <Card className="p-3 text-fg-2">
                {label.idea && <p>Idea: {label.idea}</p>}
                {label.opponentMotif && <p>Opponent: {label.opponentMotif}</p>}
              </Card>
            )}
            <Button size="sm" className="self-start" onClick={() => onDone(null)}>
              Skip to the board
            </Button>
          </div>
        )}
        {finished && (
          <Button variant="primary" className="self-start" onClick={() => onDone(last.res.grade)}>
            Now find the move
          </Button>
        )}
      </div>
    </div>
  );
}
