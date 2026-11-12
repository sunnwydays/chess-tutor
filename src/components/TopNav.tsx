"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { dueCount, loadQueue } from "@/lib/review/queue";
import { cx } from "./ui";

/** Shared header: wordmark + Lessons / Review (with due badge) / Label. */
export default function TopNav() {
  const path = usePathname();
  const [due, setDue] = useState(0);
  useEffect(() => {
    const q = loadQueue();
    setDue(dueCount(q.items, q.clock));
  }, [path]);

  const link = (href: string, label: string, badge?: number) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link
        href={href}
        className={cx(
          "relative inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
          active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
        )}
      >
        {label}
        {badge ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">
            {badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M8 20h8M9 17h6M12 4c-2 0-3.5 1.5-3.5 3.3 0 1.4.8 2.4 1.6 3.2L9 15h6l-1.1-4.5c.8-.8 1.6-1.8 1.6-3.2C15.5 5.5 14 4 12 4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Critical Moments</span>
        </Link>
        <nav className="flex items-center gap-1">
          {link("/", "Lessons")}
          {link("/review", "Review", due)}
          {link("/label", "Label")}
        </nav>
      </div>
    </header>
  );
}
