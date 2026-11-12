"use client";

import { Chess } from "chess.js";
import type { EngineLine as Line } from "@/lib/engine/types";
import { Button, Card, Chip, Eyebrow, Kbd, cx } from "./ui";

export interface LineStep {
  /** Move number label, e.g. "12." or "12..." (only where it's needed). */
  label: string;
  san: string;
  /** Position after this ply. */
  fen: string;
  from: string;
  to: string;
}

/** Replay the PV from `fen` so each ply has a position to show on the board. */
export function buildLineSteps(fen: string, pv: string[]): LineStep[] {
  const out: LineStep[] = [];
  try {
    const chess = new Chess(fen);
    const parts = fen.split(" ");
    let num = Number(parts[5]) || 1;
    let white = parts[1] !== "b";
    pv.forEach((san, i) => {
      const m = chess.move(san);
      const label = white ? `${num}.` : i === 0 ? `${num}...` : "";
      out.push({ label, san: m.san, fen: chess.fen(), from: m.from, to: m.to });
      if (!white) num++;
      white = !white;
    });
  } catch {
    // PV came from the engine, so this only trims a malformed tail.
  }
  return out;
}

function evalLabel(line: Line): string {
  if (line.mate !== null) return `#${Math.abs(line.mate)}`;
  const v = line.evalCp / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

interface Props {
  line: Line;
  steps: LineStep[];
  /** Plies shown on the board (1-based), 0 = start, null = not stepping the line. */
  k: number | null;
  onSelect: (k: number) => void;
  onBack: () => void;
}

/** The engine's best line, as clickable plies. Only rendered once the move has been shown. */
export default function EngineLine({ line, steps, k, onSelect, onBack }: Props) {
  return (
    <Card className="p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Eyebrow>Engine line</Eyebrow>
        <Chip className="font-mono">{evalLabel(line)}</Chip>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span>step</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {steps.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {s.label && <span className="font-mono text-xs text-muted">{s.label}</span>}
            <button
              type="button"
              onClick={() => onSelect(i + 1)}
              className={cx(
                "rounded-md px-1.5 py-0.5 font-mono text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                k === i + 1 ? "bg-accent text-accent-ink" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
              )}
            >
              {s.san}
            </button>
          </span>
        ))}
      </div>
      {k !== null && (
        <div className="mt-3">
          <Button size="sm" variant="primary" onClick={onBack}>
            Back to the position
          </Button>
        </div>
      )}
    </Card>
  );
}
