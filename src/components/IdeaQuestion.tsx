"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { logEvent, type LogEventInput } from "@/lib/log";
import type { RubricGrade, RubricLabel, RubricScores } from "@/lib/review/rubric";

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

const GRADE_UI: Record<RubricGrade, { label: string; cls: string }> = {
  correct: { label: "Correct", cls: "bg-emerald-700 text-white" },
  "missing-details": { label: "Missing details", cls: "bg-amber-600 text-white" },
  incorrect: { label: "Not quite", cls: "bg-red-700 text-white" },
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
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="w-full max-w-[520px]">
        <Board fen={fen} orientation={orientation} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="text-lg font-medium">Explain the idea</h2>
        <p className="text-sm text-zinc-500">No move this time. Words only; the board comes after.</p>

        {turns.map((t, i) => (
          <div key={i} className="rounded border border-zinc-800 p-3 text-sm">
            <p className="text-zinc-300">&ldquo;{t.answer}&rdquo;</p>
            <span className={`mt-2 inline-block rounded px-2 py-0.5 text-xs ${GRADE_UI[t.res.grade].cls}`}>
              {GRADE_UI[t.res.grade].label}
            </span>
          </div>
        ))}

        {!finished && (
          <>
            <p className="text-sm text-zinc-200">{question}</p>
            <textarea
              className="min-h-[4rem] rounded border border-zinc-700 bg-zinc-900 p-2 text-sm"
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
            <button
              className="self-start rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-40"
              disabled={loading || !answer.trim()}
              onClick={() => void submit()}
            >
              {loading ? "Grading..." : "Submit"}
            </button>
          </>
        )}
        {error && (
          <div className="text-sm text-red-400">
            {error}
            {(label.idea || label.opponentMotif) && (
              <div className="mt-2 rounded border border-zinc-800 p-2 text-zinc-300">
                {label.idea && <p>Idea: {label.idea}</p>}
                {label.opponentMotif && <p>Opponent: {label.opponentMotif}</p>}
              </div>
            )}{" "}
            <button className="underline" onClick={() => onDone(null)}>
              Skip to the board
            </button>
          </div>
        )}
        {finished && (
          <button
            className="self-start rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600"
            onClick={() => onDone(last.res.grade)}
          >
            Now find the move
          </button>
        )}
      </div>
    </div>
  );
}
