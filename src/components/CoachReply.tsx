"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chess } from "chess.js";
import type { AttemptVerdict, CoachResponse, Stage } from "@/lib/coach/schema";
import type { MomentAnalysis } from "@/lib/engine/types";
import { normSan } from "@/lib/coach/verdict";
import { who } from "@/lib/me";
import { Card, Chip, Spinner, TextSkeleton, cx } from "./ui";

export interface HoverMove {
  from: string;
  to: string;
}

type Tone = "neutral" | "accent" | "amber" | "danger";
const VERDICTS: Record<AttemptVerdict, { label: string; tone: Tone }> = {
  best: { label: "Best move", tone: "accent" },
  good: { label: "Good move", tone: "accent" },
  inaccuracy: { label: "Inaccuracy", tone: "amber" },
  mistake: { label: "Mistake", tone: "danger" },
  unknown: { label: "Not in the top lines", tone: "neutral" },
};

/** Why a reply is engine-only. The ladder still works; only the wording comes from code. */
const NOTICE_LABEL: Record<NonNullable<CoachResponse["notice"]> | "none", string> = {
  none: "engine-only reply",
  "rate-limited": "engine-only reply: the demo's AI limit is reached, try again in a few minutes",
  budget: "engine-only reply: the demo's AI budget is used up",
  unavailable: "engine-only reply: the AI coach is offline",
};

const SAN_RE = /(?<![A-Za-z0-9])(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z0-9])/g;

/** Resolve a SAN against the position; null when it isn't a legal move there. */
export function resolveSan(fen: string, san: string): HoverMove | null {
  try {
    const m = new Chess(fen).move(san);
    return { from: m.from, to: m.to };
  } catch {
    return null;
  }
}

/** A SAN that previews its arrow on the board while hovered or focused. */
export function MoveLink({
  san,
  move,
  onHoverMove,
  className,
}: {
  san: string;
  move: HoverMove;
  onHoverMove?: (m: HoverMove | null) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cx(
        "rounded-sm font-mono text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      onMouseEnter={() => onHoverMove?.(move)}
      onMouseLeave={() => onHoverMove?.(null)}
      onFocus={() => onHoverMove?.(move)}
      onBlur={() => onHoverMove?.(null)}
    >
      {san}
    </button>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const TYPE_MS = 600;
const TICK_MS = 30;

/**
 * Reply text with a short word-by-word reveal (<= ~600ms) and optional SAN hover.
 * `canHover(san)` decides which SAN tokens may preview an arrow: before the move
 * rung the answer must stay hidden (retrieval first), so most cards pass false.
 */
function ReplyText({
  text,
  fen,
  animate,
  canHover,
  onHoverMove,
}: {
  text: string;
  fen: string;
  animate: boolean;
  canHover: (san: string) => boolean;
  onHoverMove?: (m: HoverMove | null) => void;
}) {
  const chunks = useMemo(() => text.split(/(\s+)/), [text]);
  const words = useMemo(() => chunks.filter((c) => c.trim() !== "").length, [chunks]);
  const [shown, setShown] = useState(() => (animate && !prefersReducedMotion() ? 0 : words));

  useEffect(() => {
    if (!animate) {
      setShown(words);
      return;
    }
    if (shown >= words) return;
    const step = Math.max(1, Math.ceil(words / (TYPE_MS / TICK_MS)));
    const id = setInterval(() => setShown((s) => Math.min(words, s + step)), TICK_MS);
    return () => clearInterval(id);
  }, [animate, shown, words]);

  // Keep only the first `shown` words (and the whitespace between them).
  let seen = 0;
  const visible: string[] = [];
  for (const c of chunks) {
    if (c.trim() === "") {
      if (seen > 0 && seen <= shown) visible.push(c);
      continue;
    }
    if (seen >= shown) break;
    seen++;
    visible.push(c);
  }
  const body = visible.join("");

  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(SAN_RE)) {
    const san = m[1];
    const idx = m.index ?? 0;
    const move = canHover(san) ? resolveSan(fen, san) : null;
    if (!move) continue;
    if (idx > last) parts.push(body.slice(last, idx));
    parts.push(<MoveLink key={idx} san={san} move={move} onHoverMove={onHoverMove} />);
    last = idx + san.length;
  }
  parts.push(body.slice(last));

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-2" onClick={() => setShown(words)}>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </p>
  );
}

interface ReplyProps {
  stage: Stage;
  attempt?: string;
  response: CoachResponse;
  moment: MomentAnalysis;
  me: boolean;
  /** Reveal word by word (only the newest reply). */
  animate: boolean;
  /** Moves may be previewed from the move rung onwards (engine line shown). */
  hoverAll: boolean;
  onHoverMove?: (m: HoverMove | null) => void;
  /** Pulse the card (the player repeated this attempt instead of getting a new reply). */
  flash?: boolean;
}

export default function CoachReply({ stage, attempt, response, moment, me, animate, hoverAll, onHoverMove, flash }: ReplyProps) {
  const verdict = stage === "attempt" && response.attemptVerdict ? VERDICTS[response.attemptVerdict] : null;
  const isPlayed = stage === "attempt" && attempt && normSan(attempt) === normSan(moment.played);
  const hasHeader = stage === "attempt" || response.source === "fallback";
  // Before the move rung only the attempted move itself may be previewed.
  const canHover = (san: string) => hoverAll || (stage === "attempt" && !!attempt && normSan(san) === normSan(attempt));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [flash]);

  return (
    <Card ref={ref} className={cx("animate-fade-up p-3.5", flash && "flash-ring border-accent/60")}>
      {hasHeader && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {stage === "attempt" && attempt && <AttemptPill san={attempt} fen={moment.fenBefore} onHoverMove={onHoverMove} />}
          {verdict && <Chip tone={verdict.tone}>{verdict.label}</Chip>}
          {isPlayed && <Chip>{who(me).sameMove}</Chip>}
          {response.source === "fallback" && (
            <span className="text-xs text-muted">{NOTICE_LABEL[response.notice ?? "none"]}</span>
          )}
        </div>
      )}
      <ReplyText
        text={response.reply.text}
        fen={moment.fenBefore}
        animate={animate}
        canHover={canHover}
        onHoverMove={onHoverMove}
      />
    </Card>
  );
}

/** The tried move as a pill; hovering it previews the move's arrow. */
function AttemptPill({ san, fen, onHoverMove }: { san: string; fen: string; onHoverMove?: (m: HoverMove | null) => void }) {
  const move = resolveSan(fen, san);
  if (!move) return <Chip className="font-mono text-fg">{san}</Chip>;
  return (
    <button
      type="button"
      className="group rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      onMouseEnter={() => onHoverMove?.(move)}
      onMouseLeave={() => onHoverMove?.(null)}
      onFocus={() => onHoverMove?.(move)}
      onBlur={() => onHoverMove?.(null)}
    >
      <Chip className="font-mono text-fg underline decoration-dotted underline-offset-2 group-hover:decoration-solid">{san}</Chip>
    </button>
  );
}

/** Placeholder card while a reply is being fetched. */
export function CoachThinking({
  attempt,
  fen,
  onHoverMove,
}: {
  attempt?: string;
  fen?: string;
  onHoverMove?: (m: HoverMove | null) => void;
}) {
  return (
    <Card className="animate-fade-in p-3.5">
      {attempt && (
        <div className="mb-2">
          {fen ? <AttemptPill san={attempt} fen={fen} onHoverMove={onHoverMove} /> : <Chip className="font-mono text-fg">{attempt}</Chip>}
        </div>
      )}
      <TextSkeleton lines={3} />
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <Spinner className="size-3" />
        Coach is thinking
      </div>
    </Card>
  );
}
