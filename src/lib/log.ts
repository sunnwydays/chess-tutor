/**
 * Interaction log: one JSONL row per thing the player does (attempt, hint,
 * review pick, ...). The client calls `logEvent()`; POST /api/log appends the
 * row to logs/interactions.jsonl. Every A/B metric in working_notes comes
 * from this file, so keep the row shape stable and add fields, don't rename.
 */

export type LogMode = "lesson" | "review";
export type PositionKind = "original" | "sibling" | "perturbed";

export interface LogEvent {
  /** ISO timestamp, set by the client when the event happens. */
  ts: string;
  /** Random id per browser session (sessionStorage). */
  sessionId: string;
  mode: LogMode;
  gameId?: string;
  ply?: number;
  /** Hint-ladder rung ("attempt" | "nudge" | ...) or review form ("idea" | "find-moment"). */
  stage?: string;
  /** Assistance level the rep started at (spaced repetition dial, 0-5). */
  level?: number;
  /** The move or text the player submitted. */
  attempt?: string;
  verdict?: string;
  hintsTaken?: number;
  msToFirstAttempt?: number;
  promptVersion?: string;
  /** "ok" | "regenerated" | "fallback" from the coach validator. */
  validationResult?: string;
  reviewItemId?: string;
  positionKind?: PositionKind;
  /** Virtual clock (ms) in review mode; absent in lessons. */
  virtualClock?: number;
  /** Anything else worth keeping; stays unindexed. */
  extra?: Record<string, unknown>;
}

/** What the client sends; ts and sessionId are filled in by logEvent(). */
export type LogEventInput = Omit<LogEvent, "ts" | "sessionId">;

const SESSION_KEY = "chess-tutor-session";

/** Stable per-tab id, so rows from one sitting group together. */
export function getSessionId(): string {
  if (typeof sessionStorage === "undefined") return "server";
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "nosession";
  }
}

/**
 * Fire-and-forget from the browser. Never throws and never blocks the UI:
 * a failed log is dropped, the lesson goes on.
 */
export function logEvent(event: LogEventInput): void {
  const row: LogEvent = { ts: new Date().toISOString(), sessionId: getSessionId(), ...event };
  try {
    const body = JSON.stringify(row);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(
      () => {},
    );
  } catch {
    // ignore
  }
}

/** Shape check for the server side; rejects rows that would poison the metrics. */
export function isLogEvent(x: unknown): x is LogEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.ts === "string" &&
    typeof e.sessionId === "string" &&
    (e.mode === "lesson" || e.mode === "review")
  );
}
