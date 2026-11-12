"use client";

/**
 * Review tab: spaced repetition on a virtual clock. Serves due items one at a
 * time (a session is up to 4 reps, one of them a control stream where
 * "nothing wrong" is right). Each rep starts at the level its Leitner box says:
 * 5/4 full ladder, 2 attempt only, 1 explain the idea (Form A), 0 find the
 * moment (Form B). See design_decisions/SPACED_REPETITION.md.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import FindMoment from "@/components/FindMoment";
import IdeaQuestion from "@/components/IdeaQuestion";
import MomentPanel, { type LadderEnd } from "@/components/MomentPanel";
import { logEvent } from "@/lib/log";
import { momentKind, type MomentLabel, type MomentRecord } from "@/lib/moments";
import {
  createItem,
  dueCount,
  loadQueue,
  nextDue,
  nextPosition,
  recordRep,
  saveQueue,
  skipToFuture,
  type QueueState,
  type ReviewItem,
} from "@/lib/review/queue";
import { ladderLevelFor, type RubricGrade } from "@/lib/review/rubric";
import { ladderAfterFind, levelFor, toRep, type Level } from "@/lib/review/session";
import {
  fromRecord,
  ideaTag,
  loadLabels,
  loadSources,
  resolvePosition,
  rubricLabel,
  withPositions,
  type ReviewSource,
} from "@/lib/review/sources";
import { buildStream, type Stream, type StreamGrade } from "@/lib/review/streams";

const SESSION_LEN = 4;
const DAY = 24 * 60 * 60 * 1000;

type Rep =
  | { kind: "item"; item: ReviewItem; pos: ReviewItem["positions"][number]; src: ReviewSource; level: Level; stream: Stream | null }
  | { kind: "control"; stream: Stream };

const LEVEL_NAME: Record<Level, string> = {
  5: "Level 5: with game context",
  4: "Level 4: position, full hints",
  3: "Level 3: hints up to the piece",
  2: "Level 2: one try, no hints",
  1: "Level 1: explain the idea",
  0: "Level 0: find the moment",
};
const KIND_NAME = { original: "your original position", sibling: "a different game, same idea", perturbed: "same position, colors swapped" };

function contextLine(src: ReviewSource): string {
  const { moves } = src.game;
  const end = src.moment.ply - 1;
  const start = Math.max(0, end - 6);
  return moves
    .slice(start, end)
    .map((san, k) => {
      const ply = start + k + 1;
      const n = Math.ceil(ply / 2);
      return ply % 2 === 1 ? `${n}. ${san}` : k === 0 ? `${n}... ${san}` : san;
    })
    .join(" ");
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [records, setRecords] = useState<MomentRecord[]>([]);
  const [labels, setLabels] = useState<Record<string, MomentLabel>>({});
  const [error, setError] = useState<string | null>(null);
  const [rep, setRep] = useState<Rep | null>(null);
  const [served, setServed] = useState<string[]>([]);
  const [sessionOn, setSessionOn] = useState(false);

  useEffect(() => {
    setLabels(loadLabels());
    setQueue(loadQueue());
    fetch("/api/moments?user=sunnwy")
      .then(async (r) => {
        const body = (await r.json()) as MomentRecord[] | { error: string };
        if (!r.ok || "error" in body) throw new Error("error" in body ? body.error : "Failed");
        setRecords(body);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const byId = useMemo(() => Object.fromEntries(records.map((r) => [r.id, r])), [records]);
  const catalog = useMemo(() => {
    const out: Record<string, ReviewSource> = {};
    for (const r of records) if (momentKind(r) === "critical") out[r.id] = fromRecord(r);
    return { ...out, ...loadSources() };
  }, [records]);
  const controls = useMemo(() => records.filter((r) => momentKind(r) === "control"), [records]);

  function persist(next: QueueState) {
    saveQueue(next);
    setQueue(next);
  }

  if (!queue) return <main className="p-6 text-zinc-400">Loading...</main>;
  const due = dueCount(queue.items, queue.clock);
  const pending = queue.items.filter((it) => it.box < 3).length;
  const graduated = queue.items.length - pending;
  const day = queue.items.length ? Math.floor((queue.clock - Math.min(...queue.items.map((h) => h.history[0]?.at ?? h.dueAt))) / DAY) : 0;

  function seed() {
    const have = new Set(queue!.items.map((it) => it.id));
    const fresh = records
      .filter((r) => momentKind(r) === "critical" && labels[r.id]?.updatedAt && labels[r.id]?.useful !== "no" && !have.has(r.id))
      .map((r) => createItem(r.id, ideaTag(labels[r.id]), r.moment.fenBefore, queue!.clock));
    persist({ ...queue!, items: [...queue!.items, ...fresh] });
  }

  function skip() {
    persist({ ...queue!, clock: skipToFuture(queue!.items, queue!.clock) });
  }

  function reset() {
    if (!confirm("Clear the review queue and its history?")) return;
    persist({ items: [], clock: Date.now() });
    setRep(null);
    setSessionOn(false);
  }

  /** Pick the next rep: one control stream in slot 2, otherwise the next due item not served this session. */
  function nextRep(q: QueueState, servedIds: string[]): Rep | null {
    if (servedIds.length >= SESSION_LEN) return null;
    if (servedIds.length === 1 && controls.length && !servedIds.includes("control")) {
      const rec = controls[Math.floor(q.clock / 1000) % controls.length];
      return { kind: "control", stream: buildStream(rec, q.clock) };
    }
    const candidates = q.items.filter((it) => !servedIds.includes(it.id));
    const raw = nextDue(candidates, q.clock);
    if (!raw) return null;
    const item = withPositions(raw, catalog, labels);
    let pos = nextPosition(item) ?? item.positions[0];
    let src = resolvePosition(item, pos, catalog);
    if (!src) {
      pos = item.positions[0];
      src = resolvePosition(item, pos, catalog);
    }
    if (!src) return nextRep(q, [...servedIds, item.id]);
    const rec = pos.kind === "perturbed" ? undefined : byId[src.id];
    const level = levelFor(item, { ideaLabel: !!rubricLabel(labels[src.id] ?? labels[item.id]), stream: !!rec });
    return { kind: "item", item, pos, src, level, stream: level === 0 && rec ? buildStream(rec, q.clock) : null };
  }

  function start() {
    setSessionOn(true);
    setServed([]);
    setRep(nextRep(queue!, []));
  }

  function finish(result: { ladder: LadderEnd | null; ideaGrade?: RubricGrade; findGrade?: StreamGrade }) {
    if (!rep) return;
    let q = queue!;
    const id = rep.kind === "item" ? rep.item.id : "control";
    if (rep.kind === "item") {
      const r = toRep({ startLevel: rep.level, positionKind: rep.pos.kind, ...result });
      const updated = recordRep(rep.item, r, q.clock);
      q = { ...q, items: q.items.map((it) => (it.id === updated.id ? updated : it)) };
      persist(q);
      logEvent({
        mode: "review",
        stage: "rep",
        level: rep.level,
        verdict: r.verdict,
        hintsTaken: r.hintsTaken,
        msToFirstAttempt: r.msToFirstAttempt,
        reviewItemId: rep.item.id,
        positionKind: rep.pos.kind,
        virtualClock: q.clock,
        gameId: rep.src.gameId,
        extra: { box: updated.box, grade: r.grade, memorized: r.memorizedFlag },
      });
    }
    const s = [...served, id];
    setServed(s);
    setRep(nextRep(q, s));
  }

  const btn = "rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:opacity-40";

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Review</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-emerald-400">
          Lessons
        </Link>
        <Link href="/label" className="text-sm text-zinc-500 hover:text-emerald-400">
          Label moments
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-800 p-3 text-sm">
        <span className="text-zinc-300">
          Day {day} ({new Date(queue.clock).toLocaleDateString()})
        </span>
        <span className="text-zinc-400">
          {due} due | {pending} in queue | {graduated} learned
        </span>
        <button className={btn} disabled={due > 0 || pending === 0} onClick={skip} title="Advance the virtual clock to the next due date">
          Skip to the future
        </button>
        <button className={btn} onClick={seed} disabled={!records.length}>
          Add my labelled moments
        </button>
        <button className="ml-auto text-xs text-zinc-500 underline hover:text-zinc-300" onClick={reset}>
          reset
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!sessionOn && (
        <div className="flex flex-col gap-2 text-sm text-zinc-300">
          {queue.items.length === 0 ? (
            <p>
              Nothing queued yet. Moments you needed hints on in a lesson land here, or add your labelled moments.
            </p>
          ) : due === 0 ? (
            <p>Nothing due today. Skip to the future to see the next reps.</p>
          ) : (
            <p>
              {due} due. A session is up to {SESSION_LEN} reps; each starts with less help than the last time you saw the idea.
            </p>
          )}
          <button className="self-start rounded bg-emerald-700 px-4 py-1.5 hover:bg-emerald-600 disabled:opacity-40" disabled={due === 0} onClick={start}>
            Start session
          </button>
        </div>
      )}

      {sessionOn && !rep && (
        <div className="flex flex-col gap-2 text-sm text-zinc-300">
          <p>Session done: {served.length} reps.</p>
          <button className={`${btn} self-start`} onClick={() => setSessionOn(false)}>
            Back
          </button>
        </div>
      )}

      {sessionOn && rep && (
        <section className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">
            Rep {served.length + 1} of up to {SESSION_LEN}
            {" | "}
            {rep.kind === "control" ? "Level 0: find the moment" : `${LEVEL_NAME[rep.level]} | ${KIND_NAME[rep.pos.kind]}`}
          </p>
          {rep.kind === "control" ? (
            <FindMoment
              key={`control-${served.length}`}
              stream={rep.stream}
              logBase={{ gameId: rep.stream.gameId, virtualClock: queue.clock }}
              onDone={(g) => finish({ ladder: null, findGrade: g })}
            />
          ) : (
            <RepView key={`${rep.item.id}-${served.length}`} rep={rep} labels={labels} clock={queue.clock} onFinish={finish} />
          )}
        </section>
      )}

      {queue.items.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">Queue</summary>
          <ul className="mt-2 space-y-1">
            {queue.items.map((it) => (
              <li key={it.id}>
                {it.id} | {it.ideaTag} | box {it.box}
                {it.box < 3 ? ` | due ${new Date(it.dueAt).toLocaleDateString()}` : " | learned"} | {it.history.length} reps
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

type Item = Extract<Rep, { kind: "item" }>;

/** One queued rep: the review form for its level, then the ladder capped by the result. */
function RepView({
  rep,
  labels,
  clock,
  onFinish,
}: {
  rep: Item;
  labels: Record<string, MomentLabel>;
  clock: number;
  onFinish: (r: { ladder: LadderEnd | null; ideaGrade?: RubricGrade; findGrade?: StreamGrade }) => void;
}) {
  const { src, pos, item, level } = rep;
  const label = labels[src.id] ?? labels[item.id];
  const rubric = rubricLabel(label);
  const [form, setForm] = useState<{ ideaGrade?: RubricGrade; findGrade?: StreamGrade } | null>(level === 0 || level === 1 ? null : {});
  const [ladderLevel, setLadderLevel] = useState<Level>(level);
  const [end, setEnd] = useState<LadderEnd | null>(null);
  const logBase = { gameId: src.gameId, reviewItemId: item.id, positionKind: pos.kind, virtualClock: clock };

  if (form === null && level === 1 && rubric) {
    return (
      <IdeaQuestion
        fen={src.moment.fenBefore}
        orientation={src.game.userColor}
        label={rubric}
        logBase={logBase}
        onDone={(g) => {
          setForm(g ? { ideaGrade: g } : {});
          setLadderLevel(g ? ladderLevelFor(g) : 4);
        }}
      />
    );
  }
  if (form === null && level === 0 && rep.stream) {
    return (
      <FindMoment
        stream={rep.stream}
        logBase={logBase}
        onDone={(g) => {
          setForm({ findGrade: g });
          setLadderLevel(ladderAfterFind(g));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <MomentPanel
        game={src.game}
        moment={src.moment}
        player={{ rating: src.rating }}
        level={ladderLevel}
        mode="review"
        hideResult
        context={level === 5 ? contextLine(src) : undefined}
        logBase={logBase}
        onEnd={setEnd}
      />
      {end && (
        <div className="flex flex-col gap-2 rounded border border-zinc-800 p-3 text-sm">
          <p className="text-zinc-300">
            {end.solved && end.hintsTaken === 0
              ? "Found it with no hints. It comes back later with less help."
              : "Not this time. It comes back sooner, with a bit more help."}
          </p>
          {label?.idea && (
            <p className="text-zinc-400">
              Your note on this idea: <i>{label.idea}</i>
              {label.opponentMotif ? ` / opponent: ${label.opponentMotif}` : ""}
            </p>
          )}
          <button className="self-start rounded bg-emerald-700 px-3 py-1 hover:bg-emerald-600" onClick={() => onFinish({ ladder: end, ...form })}>
            Next rep
          </button>
        </div>
      )}
    </div>
  );
}
