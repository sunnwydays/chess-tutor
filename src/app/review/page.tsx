"use client";

/**
 * Review tab: spaced repetition on a virtual clock. Serves due items one at a
 * time (a session is up to 4 reps, one of them a control stream where
 * "nothing wrong" is right). Each rep starts at the level its Leitner box says:
 * 5/4 full ladder, 2 attempt only, 1 explain the idea (Form A), 0 find the
 * moment (Form B). See design_decisions/SPACED_REPETITION.md.
 */
import { useEffect, useMemo, useState } from "react";
import FindMoment from "@/components/FindMoment";
import IdeaQuestion from "@/components/IdeaQuestion";
import MomentPanel, { type LadderEnd } from "@/components/MomentPanel";
import { Button, Card, Chip, Eyebrow, Reveal, cx } from "@/components/ui";
import { logEvent } from "@/lib/log";
import { isMe, loadMe } from "@/lib/me";
import { momentKind, type MomentLabel, type MomentRecord } from "@/lib/moments";
import {
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
    // Precomputed moments (scripts/find_moments.ts) add control streams and
    // level-0 streams; most users have none, and review runs on lesson items alone.
    const me = loadMe();
    if (!me) return;
    fetch(`/api/moments?user=${encodeURIComponent(me)}`)
      .then(async (r) => {
        if (r.status === 404) return;
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

  if (!queue) return <main className="mx-auto max-w-6xl px-5 py-8 text-muted">Loading...</main>;
  const due = dueCount(queue.items, queue.clock);
  const pending = queue.items.filter((it) => it.box < 3).length;
  const graduated = queue.items.length - pending;
  const day = queue.items.length ? Math.floor((queue.clock - Math.min(...queue.items.map((h) => h.history[0]?.at ?? h.dueAt))) / DAY) : 0;

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

  const stats: { label: string; value: string | number; sub?: string }[] = [
    { label: "Day", value: day, sub: new Date(queue.clock).toLocaleDateString() },
    { label: "Due", value: due },
    { label: "In queue", value: pending },
    { label: "Learned", value: graduated },
  ];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-8">
      <Reveal>
        <div className="flex flex-col gap-2">
          <Eyebrow>Spaced repetition</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">Review</h1>
          <p className="max-w-prose text-fg-2">
            Positions you needed hints on come back with less help each time, until you see them cold.
          </p>
        </div>
      </Reveal>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 40}>
            <Card className="p-4">
              <div className="text-xs text-muted">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">{s.value}</div>
              {s.sub && <div className="mt-0.5 text-xs text-muted">{s.sub}</div>}
            </Card>
          </Reveal>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={skipToFuture(queue.items, queue.clock) === queue.clock} onClick={skip} title="Advance the virtual clock to the next due date">
          Skip to the future
        </Button>
        <Button variant="ghost" className="ml-auto text-muted hover:text-danger" onClick={reset}>
          Reset
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {!sessionOn && (
        <Reveal>
          <Card className="flex flex-col items-start gap-4 p-6">
            <p className="max-w-prose text-fg-2">
              {queue.items.length === 0
                ? "Nothing queued yet. Moments you needed hints on in a lesson land here."
                : due === 0
                  ? "Nothing due today. Skip to the future to see the next reps."
                  : `${due} due. A session is up to ${SESSION_LEN} reps; each starts with less help than the last time you saw the idea.`}
            </p>
            <Button variant="primary" size="lg" disabled={due === 0} onClick={start}>
              Start session
            </Button>
          </Card>
        </Reveal>
      )}

      {sessionOn && !rep && (
        <Reveal>
          <Card className="flex flex-col items-start gap-4 p-6">
            <div className="flex flex-col gap-1.5">
              <Eyebrow>Session done</Eyebrow>
              <h2 className="text-xl font-semibold text-fg">
                {served.length} rep{served.length === 1 ? "" : "s"} done
              </h2>
            </div>
            <Button onClick={() => setSessionOn(false)}>Back</Button>
          </Card>
        </Reveal>
      )}

      {sessionOn && rep && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex gap-1" aria-hidden>
                {Array.from({ length: SESSION_LEN }, (_, k) => (
                  <span
                    key={k}
                    className={cx("h-1 w-7 rounded-full", k <= served.length ? "bg-accent" : "bg-surface-3")}
                  />
                ))}
              </div>
              <span className="text-sm text-fg-2">
                Rep {served.length + 1} of {SESSION_LEN}
              </span>
            </div>
            <Chip tone="info">{rep.kind === "control" ? "Level 0: find the moment" : LEVEL_NAME[rep.level]}</Chip>
            {rep.kind === "item" && <Chip>{KIND_NAME[rep.pos.kind]}</Chip>}
          </div>
          {rep.kind === "control" ? (
            <FindMoment
              key={`control-${served.length}`}
              stream={rep.stream}
              logBase={{ gameId: rep.stream.gameId, virtualClock: queue.clock }}
              onDone={(g) => finish({ ladder: null, findGrade: g })}
            />
          ) : (
            <RepView
              key={`${rep.item.id}-${served.length}`}
              rep={rep}
              labels={labels}
              clock={queue.clock}
              me={isMe(rep.src.game[rep.src.game.userColor].username)}
              onFinish={finish}
            />
          )}
        </section>
      )}

      {queue.items.length > 0 && (
        <details className="group rounded-card border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-fg-2 hover:text-fg">
            <span>Queue ({queue.items.length})</span>
            <span className="text-xs text-muted transition-transform group-open:rotate-90" aria-hidden>
              &rsaquo;
            </span>
          </summary>
          <ul className="divide-y divide-line border-t border-line font-mono text-xs">
            {queue.items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-fg-2">
                <span className="min-w-0 flex-1 truncate">{it.id}</span>
                <span className="text-muted">{it.ideaTag}</span>
                <Chip tone={it.box < 3 ? "neutral" : "accent"}>box {it.box}</Chip>
                <span className="text-muted">
                  {it.box < 3 ? `due ${new Date(it.dueAt).toLocaleDateString()}` : "learned"} · {it.history.length} reps
                </span>
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
  me,
  onFinish,
}: {
  rep: Item;
  labels: Record<string, MomentLabel>;
  clock: number;
  me: boolean;
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
        me={me}
        leadUp={level === 5}
        logBase={logBase}
        onEnd={setEnd}
      />
      {end && (
        <Card className="flex animate-fade-up flex-col items-start gap-3 p-5 text-sm">
          <p className="text-base text-fg">
            {end.solved && end.hintsTaken === 0
              ? "Found it with no hints. It comes back later with less help."
              : end.solved
                ? `Solved with ${end.hintsTaken} hint${end.hintsTaken === 1 ? "" : "s"}. This position comes back sooner, with a bit more help.`
                : "Answer shown. This position comes back sooner, with a bit more help."}
          </p>
          {label?.idea && (
            <p className="text-fg-2 italic">
              Your note on this idea: {label.idea}
              {label.opponentMotif ? ` / opponent: ${label.opponentMotif}` : ""}
            </p>
          )}
          <Button variant="primary" onClick={() => onFinish({ ladder: end, ...form })}>
            Next rep
          </Button>
        </Card>
      )}
    </div>
  );
}
