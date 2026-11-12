"use client";

import { useEffect, useState } from "react";
import GameList from "@/components/GameList";
import Lesson from "@/components/Lesson";
import UsernameForm from "@/components/UsernameForm";
import { Button, Card, Chip, Eyebrow, ProgressBar, Reveal } from "@/components/ui";
import { isMe } from "@/lib/me";
import type { GameSummary, PlayerStats } from "@/lib/types";

interface GamesResponse {
  games: GameSummary[];
  stats: PlayerStats;
}

const STEPS = [
  {
    title: "Bottlenecks, not polish",
    body: "A game is usually decided by one to three moments. Fix the positions you keep getting wrong instead of shaving small inaccuracies everywhere.",
  },
  {
    title: "Ideas, not moves",
    body: "The coach makes you find the move with a hint ladder: where to look, what they threaten, which piece, the move. You learn the pattern, not one answer.",
  },
  {
    title: "Spaced repetition",
    body: "Moments you needed hints on come back later with less help, until you see them cold.",
  },
];

const RESULT_TONE = { win: "accent", loss: "danger", draw: "neutral" } as const;

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GamesResponse | null>(null);
  const [selected, setSelected] = useState<GameSummary | null>(null);
  const [me, setMe] = useState(false);

  // Fake-indeterminate progress: 30% at once, 70% after 600ms, 100% when data lands.
  useEffect(() => {
    if (!loading) return;
    setProgress(30);
    const t = setTimeout(() => setProgress(70), 600);
    return () => clearTimeout(t);
  }, [loading]);

  async function load(username: string) {
    setLoading(true);
    setPending(username);
    setError(null);
    setData(null);
    setSelected(null);
    try {
      const res = await fetch(`/api/games?user=${encodeURIComponent(username)}`);
      const body = (await res.json()) as GamesResponse | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error("error" in body ? body.error : `Request failed (${res.status})`);
      }
      setProgress(100);
      setMe(isMe(body.stats.username));
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const showLanding = !data && !selected;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      {showLanding && (
        <div className="flex flex-col gap-16">
          <section className="bg-grid relative rounded-card border border-line px-6 py-16 sm:px-12 sm:py-20">
            <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
              <Eyebrow>Chess.com coach</Eyebrow>
              <h1 className="text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
                Find the moments that decided your games.
              </h1>
              <p className="max-w-lg text-base text-fg-2">
                Enter a Chess.com username. Stockfish finds the one to three turning points, and the coach
                helps you work out what to do there.
              </p>
              <div className="mt-2 w-full max-w-xl text-left">
                {loading ? (
                  <LoadingCard username={pending} progress={progress} />
                ) : (
                  <UsernameForm onSubmit={load} disabled={loading} />
                )}
                {error && <p className="mt-3 text-sm text-danger">{error}</p>}
              </div>
            </Reveal>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={120 + i * 80}>
                <Card className="h-full p-6">
                  <Eyebrow>
                    <span className="font-mono tabular-nums">0{i + 1}</span>
                  </Eyebrow>
                  <h2 className="mt-3 text-lg font-semibold text-fg">{s.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-fg-2">{s.body}</p>
                </Card>
              </Reveal>
            ))}
          </section>

          <p className="text-center text-[13px] text-muted">
            Engine judges, coach explains: Stockfish computes every evaluation; the AI only puts the
            engine&apos;s verdict into words.
          </p>
        </div>
      )}

      {data && !selected && (
        <Reveal className="flex flex-col gap-5">
          <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
            <a
              href={`https://www.chess.com/member/${encodeURIComponent(data.stats.username)}`}
              target="_blank"
              rel="noreferrer"
              className="text-2xl font-semibold tracking-tight text-fg hover:text-accent"
            >
              {data.stats.username}
            </a>
            {me && <Chip tone="accent">You</Chip>}
            <div className="flex flex-wrap gap-2">
              {data.stats.rapid != null && (
                <Chip>
                  Rapid <span className="font-mono tabular-nums text-fg">{data.stats.rapid}</span>
                </Chip>
              )}
              {data.stats.blitz != null && (
                <Chip>
                  Blitz <span className="font-mono tabular-nums text-fg">{data.stats.blitz}</span>
                </Chip>
              )}
              {data.stats.bullet != null && (
                <Chip>
                  Bullet <span className="font-mono tabular-nums text-fg">{data.stats.bullet}</span>
                </Chip>
              )}
            </div>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setData(null)}>
              Change player
            </Button>
          </Card>
          <GameList games={data.games} onSelect={setSelected} />
        </Reveal>
      )}

      {selected && data && (
        <div className="flex flex-col gap-5">
          <Reveal className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              &larr; All games
            </Button>
            <p className="text-sm text-fg">
              <span className="text-muted">White</span> {selected.white.username}{" "}
              <span className="font-mono tabular-nums text-muted">{selected.white.rating}</span>
              <span className="mx-2 text-muted">vs</span>
              <span className="text-muted">Black</span> {selected.black.username}{" "}
              <span className="font-mono tabular-nums text-muted">{selected.black.rating}</span>
            </p>
            {selected.opening && <span className="truncate text-[13px] text-muted">{selected.opening}</span>}
            <div className="ml-auto flex gap-2">
              <Chip className="capitalize">{selected.timeClass}</Chip>
              <Chip tone={RESULT_TONE[selected.result]} className="capitalize">
                {selected.result}
              </Chip>
            </div>
          </Reveal>
          <Lesson
            game={selected}
            me={me}
            nextGame={data.games[data.games.findIndex((g) => g.id === selected.id) + 1] ?? null}
            onOpenGame={setSelected}
          />
        </div>
      )}
    </main>
  );
}

function LoadingCard({ username, progress }: { username: string; progress: number }) {
  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <Eyebrow>Loading</Eyebrow>
        <div className="mt-1 truncate text-3xl font-semibold tracking-tight text-fg">{username}</div>
      </div>
      <ProgressBar value={progress} />
      <div className="flex flex-col gap-2 text-sm text-fg-2">
        <Reveal delay={0}>
          <p>Fetching recent games from Chess.com</p>
        </Reveal>
        <Reveal delay={600}>
          <p>Reading results and openings</p>
        </Reveal>
        <Reveal delay={1200}>
          <p className="text-accent">Ready</p>
        </Reveal>
      </div>
    </Card>
  );
}
