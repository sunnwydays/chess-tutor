"use client";

/**
 * Labeling page: step through the critical moments found by
 * scripts/find_moments.ts and say how each one felt. Labels live in
 * localStorage; "Copy labels" puts them on the clipboard as JSON to paste
 * into the chat so they can become eval cases.
 */
import { Chess } from "chess.js";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardArrow } from "@/components/Board";
import { LABEL_TAGS, MOMENT_TYPES, momentKind, type MomentLabel, type MomentRecord } from "@/lib/moments";

const Board = dynamic(() => import("@/components/Board"), { ssr: false });

const STORAGE_KEY = "chess-tutor-labels";
const CONTEXT_PLIES = 4;

function loadLabels(): Record<string, MomentLabel> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, MomentLabel>;
  } catch {
    return {};
  }
}

/** FEN after `count` plies of `moves`, and the last move's from/to. */
function positionAt(moves: string[], count: number): { fen: string; arrow?: BoardArrow } {
  const chess = new Chess();
  let arrow: BoardArrow | undefined;
  for (let i = 0; i < count; i++) {
    const mv = chess.move(moves[i]);
    if (i === count - 1) arrow = { startSquare: mv.from, endSquare: mv.to, color: "#f59e0b" };
  }
  return { fen: chess.fen(), arrow };
}

function sanArrow(fen: string, san: string, color: string): BoardArrow | null {
  try {
    const mv = new Chess(fen).move(san);
    return { startSquare: mv.from, endSquare: mv.to, color };
  } catch {
    return null;
  }
}

function cpText(cp: number): string {
  if (Math.abs(cp) >= 10000) return cp > 0 ? "mate" : "mated";
  return (cp / 100).toFixed(1);
}

const GROUPS = ["A", "B", "C"];
const MOMENT_TYPE_HELP: Record<string, string> = {
  "only-move": "One move is clearly best; the rest lose",
  "many-roads": "Several moves are fine, the played one just wasn't",
  "multi-idea": "Two or more different plans both work",
};
const GROUP_COLORS: Record<string, string> = { A: "#22c55e", B: "#3b82f6", C: "#a855f7" };

const btn = "rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:opacity-40";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${on ? "border-emerald-500 bg-emerald-900/50" : "border-zinc-700 hover:bg-zinc-800"}`;

export default function LabelPage() {
  const [records, setRecords] = useState<MomentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, MomentLabel>>({});
  const [idx, setIdx] = useState(0);
  /** Plies shown relative to the moment's move: -4..0 game context, 1.. = punish line. */
  const [offset, setOffset] = useState(-1);
  const [showEngine, setShowEngine] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLabels(loadLabels());
    fetch("/api/moments?user=sunnwy")
      .then(async (r) => {
        const body = (await r.json()) as MomentRecord[] | { error: string };
        if (!r.ok || "error" in body) throw new Error("error" in body ? body.error : "Failed");
        // Controls (quiet positions for find-the-moment) have nothing to label.
        setRecords(body.filter((r) => momentKind(r) === "critical"));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const rec = records?.[idx];
  const label: MomentLabel = labels[rec?.id ?? ""] ?? { id: rec?.id ?? "", tags: [], notes: "", updatedAt: "" };

  const save = useCallback(
    (patch: Partial<MomentLabel>) => {
      if (!rec) return;
      setLabels((prev) => {
        const cur = prev[rec.id] ?? { id: rec.id, tags: [], notes: "", updatedAt: "" };
        const next = { ...prev, [rec.id]: { ...cur, ...patch, updatedAt: new Date().toISOString() } };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [rec],
  );

  const go = useCallback(
    (n: number) => {
      if (!records) return;
      setIdx(Math.max(0, Math.min(records.length - 1, n)));
      setOffset(-1);
      setShowEngine(false);
    },
    [records],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["TEXTAREA", "INPUT"].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === "ArrowLeft") setOffset((o) => Math.max(-CONTEXT_PLIES, o - 1));
      if (e.key === "ArrowRight") setOffset((o) => o + 1);
      if (e.key === "n") go(idx + 1);
      if (e.key === "p") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx]);

  const view = useMemo(() => {
    if (!rec) return null;
    const { moves } = rec.game;
    const { ply, fenBefore, punish } = rec.moment;
    const punishPv = punish?.pv ?? [];
    const maxOffset = Math.min(punishPv.length, 6);
    const off = Math.max(-CONTEXT_PLIES, Math.min(maxOffset, offset));
    if (off <= 0) {
      const { fen, arrow } = positionAt(moves, ply + off);
      return { fen, arrows: arrow ? [arrow] : [], caption: off === -1 ? `Before your move (you played ${rec.moment.played})` : off === 0 ? `You played ${rec.moment.played}` : `${-off} plies before`, maxOffset, off };
    }
    // Walk the punishing line from the position after the played move.
    const chess = new Chess(fenBefore);
    chess.move(rec.moment.played);
    let arrow: BoardArrow | undefined;
    for (let i = 0; i < off; i++) {
      const mv = chess.move(punishPv[i]);
      arrow = { startSquare: mv.from, endSquare: mv.to, color: "#ef4444" };
    }
    return { fen: chess.fen(), arrows: arrow ? [arrow] : [], caption: `Punish line: ${punishPv.slice(0, off).join(" ")}`, maxOffset, off };
  }, [rec, offset]);

  if (error) return <main className="p-6 text-red-400">{error}</main>;
  if (!records || !rec || !view) return <main className="p-6 text-zinc-400">Loading moments...</main>;

  const m = rec.moment;
  const g = rec.game;
  const opp = g.userColor === "white" ? g.black : g.white;
  const moveNo = Math.ceil(m.ply / 2);
  const dots = m.ply % 2 === 1 ? "." : "...";
  const engineArrows =
    showEngine && view.off === -1
      ? (m.lines.map((l) => sanArrow(m.fenBefore, l.move, GROUP_COLORS[label.lineGroups?.[l.move] ?? "A"] ?? "#22c55e")).filter(Boolean) as BoardArrow[])
      : [];
  const zone = label.zone ?? [];
  function toggleZone(sq: string) {
    save({ zone: zone.includes(sq) ? zone.filter((z) => z !== sq) : [...zone, sq] });
  }
  function cycleGroup(move: string) {
    const cur = label.lineGroups?.[move] ?? "A";
    const next = GROUPS[(GROUPS.indexOf(cur) + 1) % GROUPS.length];
    save({ lineGroups: { ...(label.lineGroups ?? {}), [move]: next } });
  }
  const labeled = records.filter((r) => labels[r.id]?.updatedAt).length;
  const context = g.moves.slice(Math.max(0, m.ply - 1 - CONTEXT_PLIES), m.ply - 1).join(" ");

  async function copy() {
    const out = records!
      .filter((r) => labels[r.id]?.updatedAt)
      .map((r) => ({
        gameUrl: r.game.url,
        ply: r.moment.ply,
        played: r.moment.played,
        best: r.moment.lines[0]?.move,
        drop: Math.round(r.moment.winProbBefore - r.moment.winProbAfter),
        ...labels[r.id],
      }));
    await navigator.clipboard.writeText(JSON.stringify(out, null, 1));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Label moments</h1>
        <span className="text-sm text-zinc-400">
          {idx + 1} / {records.length} | labeled {labeled}
        </span>
        <button className={btn} onClick={() => go(idx - 1)} disabled={idx === 0}>
          Prev (p)
        </button>
        <button className={btn} onClick={() => go(idx + 1)} disabled={idx === records.length - 1}>
          Next (n)
        </button>
        <button className={`${btn} ml-auto bg-emerald-800 hover:bg-emerald-700`} onClick={copy}>
          {copied ? "Copied" : "Copy labels as JSON"}
        </button>
      </div>

      <p className="text-sm text-zinc-300">
        <a href={g.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
          Game {g.id}
        </a>
        {" | "}
        {g.timeClass} as {g.userColor} vs {opp.username} ({opp.rating}), {g.result}
        {g.opening ? ` | ${g.opening}` : ""}
      </p>

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-full max-w-[480px]">
          <Board fen={view.fen} orientation={g.userColor} arrows={[...view.arrows, ...engineArrows]} highlightSquares={zone} highlightColor="rgba(168, 85, 247, 0.7)" onSquareClick={toggleZone} />
          <div className="mt-2 flex items-center justify-center gap-2">
            <button className={btn} onClick={() => setOffset((o) => Math.max(-CONTEXT_PLIES, o - 1))} disabled={view.off <= -CONTEXT_PLIES}>
              &larr;
            </button>
            <span className="min-w-[14rem] text-center text-sm text-zinc-300">{view.caption}</span>
            <button className={btn} onClick={() => setOffset((o) => o + 1)} disabled={view.off >= view.maxOffset}>
              &rarr;
            </button>
          </div>
          <p className="mt-1 text-center text-xs text-zinc-500">Before: {context || "(start)"}</p>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="rounded border border-zinc-800 p-3 text-sm">
            <p>
              Move {moveNo}
              {dots} <b>{m.played}</b>: win chance {m.winProbBefore.toFixed(0)}% &rarr; {m.winProbAfter.toFixed(0)}% (eval {cpText(m.evalBefore)} &rarr; {cpText(m.evalAfter)})
            </p>
            <p className="mt-3 mb-1 font-semibold text-zinc-200">1. Before the engine</p>
            <p className="mb-1 text-zinc-400">What would you play now, and why? One line. Don&apos;t edit it after seeing the engine.</p>
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-900 p-2"
              placeholder="e.g. Nf3, develops and covers e5"
              value={label.guess ?? ""}
              onChange={(e) => save({ guess: e.target.value })}
            />
            <p className="mt-3 mb-1 text-zinc-400">Did you sense the move was bad when you played it? A guess is fine.</p>
            <div className="flex flex-wrap gap-2">
              {(["knew", "suspected", "felt-fine", "no-idea"] as const).map((a) => (
                <button key={a} className={chip(label.awareness === a)} onClick={() => save({ awareness: a })}>
                  {a.replace("-", " ")}
                </button>
              ))}
            </div>
            <p className="mt-3 mb-1 font-semibold text-zinc-200">2. Then show the engine and fill in the rest</p>
            <button className={btn} onClick={() => setShowEngine((s) => !s)}>
              {showEngine ? "Hide engine" : "Show engine"}
            </button>
            {showEngine && (
              <ul className="mt-2 space-y-1 text-zinc-300">
                {m.lines.map((l, i) => {
                  const grp = label.lineGroups?.[l.move] ?? "A";
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <button
                        className="rounded px-2 text-xs font-bold text-black"
                        style={{ backgroundColor: GROUP_COLORS[grp] }}
                        title="Click to change idea group"
                        onClick={() => cycleGroup(l.move)}
                      >
                        {grp}
                      </button>
                      <span>
                        <b>{l.move}</b> ({cpText(l.evalCp)}): {l.pv.slice(0, 8).join(" ")}
                      </span>
                    </li>
                  );
                })}
                <li className="text-xs text-zinc-500">Same letter = same idea. Click the letter to change it.</li>
                {m.punish && (
                  <li className="text-red-300">
                    Punish: {m.punish.pv.slice(0, 8).join(" ")} ({cpText(m.punish.evalCp)})
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3 rounded border border-zinc-800 p-3 text-sm">
            <div>
              <p className="mb-1 text-zinc-400">What was going on?</p>
              <div className="flex flex-wrap gap-2">
                {LABEL_TAGS.map((t) => {
                  const on = label.tags.includes(t);
                  return (
                    <button key={t} className={chip(on)} onClick={() => save({ tags: on ? label.tags.filter((x) => x !== t) : [...label.tags, t] })}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1 text-zinc-400">Moment type</p>
              <div className="flex flex-wrap gap-2">
                {MOMENT_TYPES.map((t) => (
                  <button key={t} className={chip(label.momentType === t)} onClick={() => save({ momentType: t })} title={MOMENT_TYPE_HELP[t]}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-zinc-400">The idea the good engine lines share, a few words.</p>
              <input
                className="w-full rounded border border-zinc-700 bg-zinc-900 p-2"
                placeholder="e.g. pin the knight"
                value={label.idea ?? ""}
                onChange={(e) => save({ idea: e.target.value })}
              />
            </div>
            <div>
              <p className="mb-1 text-zinc-400">Opponent&apos;s motif: what the punish line threatens, or why the idea works.</p>
              <input
                className="w-full rounded border border-zinc-700 bg-zinc-900 p-2"
                placeholder="e.g. Nxe4 wins the pinned pawn"
                value={label.opponentMotif ?? ""}
                onChange={(e) => save({ opponentMotif: e.target.value })}
              />
            </div>
            <p className="text-xs text-zinc-500">
              Zone: click squares on the board (at any step) to mark where to look.{" "}
              {zone.length ? `${zone.join(" ")} ` : ""}
              {zone.length > 0 && (
                <button className="underline" onClick={() => save({ zone: [] })}>
                  clear
                </button>
              )}
            </p>
            <div>
              <p className="mb-1 text-zinc-400">Good eval case?</p>
              <div className="flex gap-2">
                {(["yes", "maybe", "no"] as const).map((u) => (
                  <button key={u} className={chip(label.useful === u)} onClick={() => save({ useful: u })}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-zinc-400">Notes: what hint would have helped? Unsure about a label? Does the engine miss something?</p>
            <textarea
              className="min-h-[6rem] rounded border border-zinc-700 bg-zinc-900 p-2"
              placeholder="free text"
              value={label.notes}
              onChange={(e) => save({ notes: e.target.value })}
            />
          </div>
        </div>
      </div>

      <ol className="flex flex-wrap gap-1 text-xs">
        {records.map((r, i) => (
          <li key={r.id}>
            <button
              onClick={() => go(i)}
              className={`rounded px-2 py-0.5 ${i === idx ? "bg-emerald-700 text-white" : labels[r.id]?.updatedAt ? "bg-zinc-700" : "bg-zinc-900 hover:bg-zinc-800"}`}
              title={`${r.game.id} ply ${r.moment.ply}`}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>
    </main>
  );
}
