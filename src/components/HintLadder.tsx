"use client";

import type { ReactNode } from "react";
import { Button, cx } from "./ui";

export type StepStatus = "done" | "available" | "locked";

export interface LadderStep {
  key: string;
  label: string;
  status: StepStatus;
  /** Button shown when this is the next step to take. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Coach reply cards, placeholder, etc. shown under the label. */
  children?: ReactNode;
}

function Node({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3.5 8.5l3 3 6-6.5" />
        </svg>
      </span>
    );
  }
  if (status === "available") {
    return <span className="size-5 shrink-0 rounded-full border-2 border-accent bg-surface" aria-hidden />;
  }
  return <span className="size-5 shrink-0 rounded-full border border-line bg-surface" aria-hidden />;
}

/** Vertical stepper: node rail on the left, label + content on the right. */
export default function HintLadder({ steps }: { steps: LadderStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.key} className={cx("flex gap-3", s.status === "locked" && "opacity-50")}>
            <div className="flex flex-col items-center">
              <Node status={s.status} />
              {!last && <div className={cx("mt-1 w-px flex-1", s.status === "done" ? "bg-accent/60" : "bg-line")} />}
            </div>
            <div className={cx("min-w-0 flex-1", !last && "pb-5")}>
              <div className="flex min-h-5 items-center gap-3">
                <span className={cx("text-sm font-medium", s.status === "locked" ? "text-muted" : "text-fg")}>{s.label}</span>
              </div>
              {s.children && <div className="mt-2.5 flex flex-col gap-2.5">{s.children}</div>}
              {s.status === "available" && s.action && (
                <div className="mt-2.5">
                  <Button size="sm" variant="secondary" disabled={s.action.disabled} onClick={s.action.onClick}>
                    {s.action.label}
                  </Button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
