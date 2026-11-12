"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { MomentAnalysis } from "@/lib/engine/types";
import type {
  CoachRequest,
  CoachResponse,
  CoachTurn,
  GameContext,
  PlayerContext,
  Stage,
} from "@/lib/coach/schema";
import { logEvent, type LogEventInput } from "@/lib/log";
import { judgeAttempt, normSan } from "@/lib/coach/verdict";
import { createBrowserEngine } from "@/lib/engine/browser";
import type { UciEngine } from "@/lib/engine/uci";
import { rungsFor, type LadderOutcome, type Level } from "@/lib/review/session";
import { who } from "@/lib/me";
import { ARROW_COLOR, type BoardArrow } from "./Board";
import CoachReply, { CoachThinking, MoveLink, resolveSan, type HoverMove } from "./CoachReply";
import EngineLine, { buildLineSteps } from "./EngineLine";
import HintLadder, { type LadderStep } from "./HintLadder";
import LeadUp, { buildLeadUp } from "./LeadUp";
import { Button, Card, Chip, Eyebrow, cx } from "./ui";

const Board = dynamic(() => import("./Board"), { ssr: false });

interface Exchange {
  stage: Stage;
  attempt?: string;
  response: CoachResponse;
}

export interface LadderEnd extends LadderOutcome {
  /** Coach's motif tag for the moment (idea tag fallback when unlabelled). */
  motif: string;
}

interface Props {
  game: GameContext;
  moment: MomentAnalysis;
  player: PlayerContext;
  /** Assistance level (spaced repetition dial). 5 and 4 = full ladder; lessons use 5. */
  level?: Level;
  mode?: "lesson" | "review";
  /** Extra fields on every log row (gameId, reviewItemId, positionKind, virtualClock). */
  logBase?: Partial<LogEventInput>;
  /** Fires once: a good/best attempt (solved) or the move shown (not solved). */
  onEnd?: (end: LadderEnd) => void;
  /** Viewer owns these games -> "you" wording. Default false. */
  me?: boolean;
  /** Show the interactive replay of the moves leading up to the position (lessons, and review level 5). Default false. */
  leadUp?: boolean;
}

/** Which position the board shows. The ladder only works on the moment itself. */
type View = { kind: "moment" } | { kind: "leadup"; ply: number } | { kind: "line"; k: number };

const RUNGS: { stage: Stage; label: string; action: string; needs: Stage }[] = [
  { stage: "focus", label: "Where to look", action: "Where to look", needs: "attempt" },
  { stage: "threat", label: "What they threaten", action: "What do they threaten?", needs: "focus" },
  { stage: "piece", label: "Which piece", action: "Which piece?", needs: "threat" },
  { stage: "move", label: "The move", action: "Show the move", needs: "piece" },
  { stage: "explain", label: "Explain", action: "Explain", needs: "move" },
];

const HINT_STAGES: Stage[] = ["focus", "threat", "piece", "move", "explain"];

/** Depth for evaluating an attempt that isn't in the moment's MultiPV lines. */
const ATTEMPT_DEPTH = 12;
const ATTEMPT_TIMEOUT_MS = 4000;

type AttemptEval = Pick<CoachRequest, "attemptEvalCp" | "attemptLine">;

/** Destination square of a SAN from a position, or null. */
function destOf(fen: string, san: string): string | null {
  try {
    return new Chess(fen).move(san).to;
  } catch {
    return null;
  }
}

export default function MomentPanel({
  game,
  moment,
  player,
  level = 5,
  mode = "lesson",
  logBase,
  onEnd,
  me = false,
  leadUp = false,
}: Props) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  /** The rung being fetched, so its placeholder card shows under the right step. */
  const [pending, setPending] = useState<{ stage: Stage; attempt?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [view, setView] = useState<View>({ kind: "moment" });
  const [hover, setHover] = useState<HoverMove | null>(null);
  /** Index of the attempt card to pulse when the same move is played again. */
  const [flash, setFlash] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  const firstAttemptMs = useRef<number | null>(null);
  const ended = useRef(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const engine = useRef<UciEngine | null>(null);
  /** Coach replies fetched ahead while the player reads: key = exchanges so far + stage. */
  const prefetched = useRef(new Map<string, Promise<CoachResponse>>());
  useEffect(() => {
    startedAt.current = Date.now();
    // Likely first attempts (the best/good moves) are fetched as soon as the moment opens.
    prefetchAttempts([]);
    return () => {
      engine.current?.terminate();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const taken = (s: Stage) => exchanges.some((e) => e.stage === s);
  const allowed = rungsFor(level);
  const hintsIn = (xs: Exchange[]) => xs.filter((e) => HINT_STAGES.includes(e.stage)).length;

  function log(row: Partial<LogEventInput>) {
    logEvent({ mode, ply: moment.ply, level, ...logBase, ...row });
  }
  const latest = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
  const isSolved = (xs: Exchange[]) =>
    xs.some((e) => e.stage === "attempt" && (e.response.attemptVerdict === "best" || e.response.attemptVerdict === "good"));
  const solved = isSolved(exchanges);
  const oneTry = level <= 2;

  const explained = taken("explain");
  // The engine line (and SAN previews of any move) only exist from the move rung on.
  const showLine = explained || taken("move");
  const top = moment.lines[0];

  // Replays for the two "viewing another position" modes.
  const leadSteps = useMemo(() => (leadUp ? buildLeadUp(game.moves, moment.ply) : []), [leadUp, game.moves, moment.ply]);
  const lineSteps = useMemo(
    () => (showLine && top ? buildLineSteps(moment.fenBefore, top.pv) : []),
    [showLine, top, moment.fenBefore],
  );

  const viewing = view.kind !== "moment";

  function stepView(delta: number) {
    setView((v) => {
      if (v.kind === "leadup") {
        const ply = v.ply + delta;
        if (ply > leadSteps.length) return { kind: "moment" };
        return { kind: "leadup", ply: Math.max(1, ply) };
      }
      if (v.kind === "line") return { kind: "line", k: Math.min(lineSteps.length, Math.max(0, v.k + delta)) };
      return v;
    });
  }

  // One keydown handler for both viewing modes; only one is ever active.
  useEffect(() => {
    if (view.kind === "moment") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepView(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepView(1);
      } else if (e.key === "Escape") {
        setView({ kind: "moment" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // stepView closes over the step counts only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind, leadSteps.length, lineSteps.length]);

  async function fetchCoach(stage: Stage, xs: Exchange[], attempt?: string, extra?: AttemptEval): Promise<CoachResponse> {
    const history: CoachTurn[] = xs.map((e) => ({
      stage: e.stage,
      ...(e.attempt ? { attempt: e.attempt } : {}),
      text: e.response.reply.text,
    }));
    const body: CoachRequest = { game, moment, player, stage, history, ...(attempt ? { attempt } : {}), ...extra };
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as CoachResponse | { error: string };
    if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Request failed");
    return data;
  }

  /** The rung the player is most likely to click next, so it can be fetched while they read. */
  function nextRung(xs: Exchange[]): Stage | null {
    const has = (s: Stage) => xs.some((e) => e.stage === s);
    if (isSolved(xs)) return has("explain") ? null : "explain";
    const r = RUNGS.find((r) => allowed.includes(r.stage) && !has(r.stage) && has(r.needs));
    return r?.stage ?? null;
  }

  function prefetch(xs: Exchange[]) {
    const stage = nextRung(xs);
    if (!stage) return;
    const key = `${xs.length}|${stage}`;
    if (prefetched.current.has(key)) return;
    const p = fetchCoach(stage, xs);
    p.catch(() => prefetched.current.delete(key));
    prefetched.current.set(key, p);
  }

  const attemptKey = (n: number, san: string) => `${n}|attempt|${normSan(san)}`;

  /**
   * Attempts that would solve the moment (best/good lines) get their reply
   * fetched ahead: all of them (max 3) when the moment opens, only the best
   * move after each hint. These moves are in the MultiPV set, so the request
   * is identical to the one `send` would make (no in-browser analysis needed).
   */
  function prefetchAttempts(xs: Exchange[]) {
    if (isSolved(xs)) return;
    const solving = moment.lines.filter((l) => {
      const v = judgeAttempt(moment, l.move).verdict;
      return v === "best" || v === "good";
    });
    const targets = xs.length === 0 ? solving.slice(0, 3) : solving.slice(0, 1);
    for (const l of targets) {
      const key = attemptKey(xs.length, l.move);
      if (prefetched.current.has(key)) continue;
      const p = fetchCoach("attempt", xs, l.move);
      p.catch(() => prefetched.current.delete(key));
      prefetched.current.set(key, p);
    }
  }

  /** Engine eval + reply line for an attempt outside the MultiPV set, so the coach can say what it allows. */
  async function analyseAttempt(san: string): Promise<AttemptEval> {
    if (moment.lines.some((l) => normSan(l.move) === normSan(san)) || normSan(moment.played) === normSan(san)) return {};
    try {
      const chess = new Chess(moment.fenBefore);
      chess.move(san);
      engine.current ??= createBrowserEngine();
      const search = engine.current.lines(chess.fen(), ATTEMPT_DEPTH, 1, game.userColor === "white");
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), ATTEMPT_TIMEOUT_MS));
      const lines = await Promise.race([search, timeout]);
      const l = lines?.[0];
      return l ? { attemptEvalCp: l.evalCp, attemptLine: l.pv.slice(0, 6) } : {};
    } catch {
      return {};
    }
  }

  async function send(stage: Stage, attempt?: string) {
    setLoading(true);
    setPending({ stage, attempt });
    setError(null);
    setConfirmSkip(false);
    setHover(null);
    const key = attempt ? attemptKey(exchanges.length, attempt) : `${exchanges.length}|${stage}`;
    try {
      const pre = prefetched.current.get(key);
      const data = pre ? await pre : await fetchCoach(stage, exchanges, attempt, attempt ? await analyseAttempt(attempt) : undefined);
      const next = [...exchanges, { stage, attempt, response: data }];
      setExchanges(next);
      prefetch(next);
      prefetchAttempts(next);
      const hintsTaken = hintsIn(next);
      const validationResult = data.source === "fallback" ? "fallback" : data.errors?.length ? "regenerated" : "ok";
      log({
        stage,
        attempt,
        verdict: data.attemptVerdict ?? undefined,
        hintsTaken,
        msToFirstAttempt: firstAttemptMs.current ?? undefined,
        validationResult,
      });
      const solvedNow = stage === "attempt" && (data.attemptVerdict === "best" || data.attemptVerdict === "good");
      if (!ended.current && (solvedNow || stage === "move")) {
        ended.current = true;
        const attempts = next.filter((e) => e.stage === "attempt").length;
        const end: LadderEnd = {
          solved: solvedNow,
          hintsTaken,
          wrongAttempts: solvedNow ? attempts - 1 : attempts,
          msToFirstAttempt: firstAttemptMs.current ?? 0,
          motif: next.map((e) => e.response.reply.motif).filter(Boolean).pop() ?? "",
        };
        log({ stage: "end", verdict: solvedNow ? "solved" : "shown", hintsTaken, msToFirstAttempt: end.msToFirstAttempt });
        onEnd?.(end);
      }
    } catch (err) {
      prefetched.current.delete(key);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
      setPending(null);
      setBoardKey((k) => k + 1);
    }
  }

  function onMove(from: string, to: string): boolean {
    if (loading) return false;
    let san: string;
    try {
      san = new Chess(moment.fenBefore).move({ from, to, promotion: "q" }).san;
    } catch {
      return false;
    }
    // Same move again: no new reply, just point at the one it already got.
    const seen = exchanges.findIndex((e) => e.stage === "attempt" && e.attempt && normSan(e.attempt) === normSan(san));
    if (seen >= 0) {
      setFlash(seen);
      setBoardKey((k) => k + 1);
      return false;
    }
    // Level 2 and below: one try. After a miss, only "Show the answer" is left.
    if (oneTry && taken("attempt") && !solved) return false;
    if (firstAttemptMs.current === null) firstAttemptMs.current = Date.now() - startedAt.current;
    void send("attempt", san);
    return true;
  }

  // ---- Board state ----
  const arrows: BoardArrow[] = (latest?.response.reply.arrows ?? []).map((a) => ({
    startSquare: a.from,
    endSquare: a.to,
    color: ARROW_COLOR[a.kind] ?? ARROW_COLOR.move,
  }));
  // SAN hover preview is drawn last (on top).
  if (hover) arrows.push({ startSquare: hover.from, endSquare: hover.to, color: ARROW_COLOR.hover });
  // Tunnel vision: the focus zone stays lit (rest faded) through the threat rung.
  const focusEx = exchanges.find((e) => e.stage === "focus");
  const focus = focusEx && (latest?.stage === "focus" || latest?.stage === "threat") ? focusEx.response.reply.squares : undefined;
  const motif = latest?.response.reply.motif ?? "";
  const showMotif = taken("attempt") && motif.trim() !== "";

  // Pulse: the piece to move at the piece rung, the destination at move/explain.
  let pulse: string[] = [];
  if (latest?.stage === "piece") pulse = latest.response.reply.squares;
  else if (latest?.stage === "move" || latest?.stage === "explain") {
    const dest =
      latest.response.reply.arrows.filter((a) => a.kind === "move").pop()?.to ?? (top ? destOf(moment.fenBefore, top.move) : null);
    if (dest) pulse = [dest];
  }
  const highlight = latest && latest.stage !== "focus" && latest.stage !== "piece" ? latest.response.reply.squares : [];

  let boardFen = moment.fenBefore;
  let lastMove: { from: string; to: string } | undefined;
  if (view.kind === "leadup") {
    const s = leadSteps[view.ply - 1];
    if (s) {
      boardFen = s.fen;
      lastMove = { from: s.from, to: s.to };
    }
  } else if (view.kind === "line" && view.k > 0) {
    const s = lineSteps[view.k - 1];
    if (s) {
      boardFen = s.fen;
      lastMove = { from: s.from, to: s.to };
    }
  }

  const n = Math.ceil(moment.ply / 2);
  const dots = moment.ply % 2 === 0 ? "..." : ".";
  const backToMoment = () => setView({ kind: "moment" });

  // ---- Ladder steps ----
  const card = (e: Exchange, i: number) => (
    <CoachReply
      key={i}
      stage={e.stage}
      attempt={e.attempt}
      response={e.response}
      moment={moment}
      me={me}
      animate={i === exchanges.length - 1}
      hoverAll={showLine}
      onHoverMove={setHover}
      flash={flash === i}
    />
  );
  const cardsFor = (stage: Stage) =>
    exchanges.map((e, i) => (e.stage === stage ? card(e, i) : null)).filter((c) => c !== null);

  const hasAttempt = taken("attempt");
  const attemptBody = (
    <>
      {!hasAttempt && pending?.stage !== "attempt" && (
        <p className="flex items-center gap-2 text-sm text-fg-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          Play a move on the board.
        </p>
      )}
      {cardsFor("attempt")}
      {pending?.stage === "attempt" && <CoachThinking attempt={pending.attempt} />}
      {solved && !explained && pending?.stage !== "explain" && (
        <Card className="animate-pop border-accent/30 bg-accent/5 p-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="sm" variant="primary" disabled={loading} onClick={() => void send("explain")}>
              Show the full explanation
            </Button>
            <span className="text-sm text-muted">or find another good move on the board.</span>
          </div>
        </Card>
      )}
    </>
  );

  const steps: LadderStep[] = [
    { key: "attempt", label: "Attempt", status: hasAttempt ? "done" : "available", children: attemptBody },
  ];
  if (solved) {
    // Solved: the remaining rungs are hidden; Explain appears once asked for.
    if (explained || pending?.stage === "explain") {
      steps.push({
        key: "explain",
        label: "Explain",
        status: explained ? "done" : "available",
        children: (
          <>
            {cardsFor("explain")}
            {pending?.stage === "explain" && <CoachThinking />}
          </>
        ),
      });
    }
  } else {
    for (const r of RUNGS.filter((r) => allowed.includes(r.stage) || (r.stage === "explain" && taken("move")))) {
      const isTaken = taken(r.stage);
      const isPending = pending?.stage === r.stage;
      const cards = cardsFor(r.stage);
      steps.push({
        key: r.stage,
        label: r.label,
        status: isTaken ? "done" : taken(r.needs) ? "available" : "locked",
        action: isPending ? undefined : { label: r.action, onClick: () => void send(r.stage), disabled: loading },
        children:
          cards.length > 0 || isPending ? (
            <>
              {cards}
              {isPending && <CoachThinking />}
            </>
          ) : undefined,
      });
    }
  }

  const canSkip = hasAttempt && !taken("move") && !solved;
  const played = who(me).played;
  const playedMove = resolveSan(moment.fenBefore, moment.played);
  const dropped = moment.winProbAfter < moment.winProbBefore;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[560px] xl:w-[600px]">
        <Board
          key={boardKey}
          fen={boardFen}
          orientation={game.userColor}
          // Other positions are read-only and drop every hint overlay.
          arrows={viewing ? [] : arrows}
          highlightSquares={viewing ? [] : highlight}
          focus={viewing ? undefined : focus}
          pulseSquares={viewing ? [] : pulse}
          lastMove={lastMove}
          onMove={viewing || (oneTry && hasAttempt && !solved) ? undefined : onMove}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <Eyebrow>
            Move {n}
            {dots}
          </Eyebrow>
          <h2 className="text-xl font-semibold tracking-tight">What would you play?</h2>
          {level < 4 && (
            <div className="pt-1">
              <Chip tone="info">{level === 3 ? "Hints up to the piece." : "No hints this time: one try, or show the answer."}</Chip>
            </div>
          )}
        </header>

        {leadUp && (
          <LeadUp
            steps={leadSteps}
            active={view.kind === "leadup" ? view.ply : null}
            onSelect={(ply) => setView({ kind: "leadup", ply })}
            onPrev={() => setView((v) => (v.kind === "leadup" ? { kind: "leadup", ply: Math.max(1, v.ply - 1) } : { kind: "leadup", ply: leadSteps.length }))}
            onNext={() => stepView(1)}
            onBack={backToMoment}
          />
        )}

        {viewing && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">Viewing another position</span>
            <Button size="sm" variant="primary" onClick={backToMoment}>
              Back to the position
            </Button>
          </div>
        )}

        {showMotif && (
          <div>
            <Chip tone="neutral">Motif: {motif}</Chip>
          </div>
        )}

        <div>
          {/* Ladder only works on the moment itself, not while viewing a replay. */}
          <div inert={viewing} className={cx("transition-opacity", viewing && "opacity-40")}>
            <HintLadder steps={steps} />

            {canSkip && !confirmSkip && (
              <Button variant="ghost" size="sm" className="mt-3 text-muted" disabled={loading} onClick={() => setConfirmSkip(true)}>
                {allowed.includes("move") ? "Skip to the move" : "Show the answer"}
              </Button>
            )}
            {canSkip && confirmSkip && (
              <Card className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm text-fg-2">
                Show the answer now? It counts as not found.
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={loading} onClick={() => void send("move")}>
                    Show it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmSkip(false)}>
                    Keep trying
                  </Button>
                </span>
              </Card>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </div>

        {showLine && top && (
          <EngineLine
            line={top}
            steps={lineSteps}
            k={view.kind === "line" ? view.k : null}
            onSelect={(k) => setView({ kind: "line", k })}
            onBack={backToMoment}
          />
        )}

        {ended.current && (
          <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
            <span className="text-sm text-muted">{played}</span>
            {playedMove ? (
              <MoveLink san={moment.played} move={playedMove} onHoverMove={setHover} className="text-sm" />
            ) : (
              <span className="font-mono text-sm text-fg">{moment.played}</span>
            )}
            <Chip tone={dropped ? "danger" : "neutral"} className="ml-auto">
              Win chance {moment.winProbBefore.toFixed(0)}% → {moment.winProbAfter.toFixed(0)}%
            </Chip>
          </Card>
        )}
      </div>
    </div>
  );
}
