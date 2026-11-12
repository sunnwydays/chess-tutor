"use client";

/**
 * Shared UI primitives. Every page and component builds from these so the
 * look stays consistent: one button scale, one card, one chip, one skeleton.
 */
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold hover:bg-accent-strong shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_6px_18px_-8px_rgba(110,231,167,0.6)]",
  secondary: "bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-3",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-2",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  lg: "h-12 px-5 text-base rounded-xl gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    />
  );
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx("rounded-card border border-line bg-surface", className)} />;
}

type Tone = "neutral" | "accent" | "amber" | "danger" | "info";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-2 border-line-strong",
  accent: "bg-accent/15 text-accent border-accent/30",
  amber: "bg-amber/15 text-amber border-amber/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  info: "bg-info/15 text-info border-info/30",
};

export function Chip({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      {...rest}
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium leading-none",
        TONE[tone],
        className,
      )}
    />
  );
}

/** Small uppercase section label. */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cx("text-[11px] font-semibold uppercase tracking-[0.14em] text-muted", className)}
    />
  );
}

/** Fade-and-rise wrapper for content that just arrived. `delay` in ms staggers lists. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={cx("animate-fade-up", className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Shimmering text placeholder. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton h-3.5", className)} aria-hidden />;
}

/** Three-line coach-is-typing placeholder. */
export function TextSkeleton({ lines = 3 }: { lines?: number }) {
  const widths = ["w-[92%]", "w-[78%]", "w-[60%]", "w-[85%]"];
  return (
    <div className="flex flex-col gap-2.5 py-1">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={widths[i % widths.length]} />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-fg/20 border-t-accent",
        className,
      )}
    />
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Inline keyboard key, for shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[11px] text-fg-2">
      {children}
    </kbd>
  );
}
