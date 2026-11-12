"use client";

import { useState } from "react";
import { Chess } from "chess.js";
import { Button, Card, Eyebrow, Kbd, cx } from "./ui";

export interface LeadStep {
  /** 1-based ply in the game. */
  ply: number;
  san: string;
  /** Position after this ply. */
  fen: string;
  from: string;
  to: string;
}

/**
 * Replay the game up to (not including) the moment's ply. Stops at ply - 1 on
 * purpose: the move played at the moment must not leak into the replay.
 */
export function buildLeadUp(moves: string[], momentPly: number): LeadStep[] {
  const out: LeadStep[] = [];
  try {
    const chess = new Chess();
    for (let i = 0; i < momentPly - 1 && i < moves.length; i++) {
      const m = chess.move(moves[i]);
      out.push({ ply: i + 1, san: m.san, fen: chess.fen(), from: m.from, to: m.to });
    }
  } catch {
    // Keep what replayed cleanly.
  }
  return out;
}

const RECENT = 8;

interface Props {
  steps: LeadStep[];
  /** Ply being shown on the board, or null when showing the moment itself. */
  active: number | null;
  onSelect: (ply: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onBack: () => void;
}

/** "How we got here": the last few half-moves, clickable, with Prev/Next. */
export default function LeadUp({ steps, active, onSelect, onPrev, onNext, onBack }: Props) {
  const [showAll, setShowAll] = useState(false);
  if (steps.length === 0) return null;

  const hidden = showAll ? 0 : Math.max(0, steps.length - RECENT);
  const visible = steps.slice(hidden);

  return (
    <Card className="p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Eyebrow>How we got here</Eyebrow>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {hidden > 0 && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setShowAll(true)}>
            show all ({hidden} earlier)
          </Button>
        )}
        {visible.map((s, i) => {
          const white = s.ply % 2 === 1;
          const num = Math.ceil(s.ply / 2);
          const label = white ? `${num}.` : i === 0 ? `${num}...` : "";
          return (
            <span key={s.ply} className="inline-flex items-center gap-1">
              {label && <span className="font-mono text-xs text-muted">{label}</span>}
              <button
                type="button"
                onClick={() => onSelect(s.ply)}
                className={cx(
                  "rounded-md px-1.5 py-0.5 font-mono text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  active === s.ply ? "bg-accent text-accent-ink" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
                )}
              >
                {s.san}
              </button>
            </span>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onPrev} disabled={active === 1}>
          Prev
        </Button>
        <Button size="sm" variant="secondary" onClick={onNext} disabled={active === null}>
          Next
        </Button>
        {active !== null && (
          <Button size="sm" variant="primary" onClick={onBack}>
            Back to the position
          </Button>
        )}
      </div>
    </Card>
  );
}
