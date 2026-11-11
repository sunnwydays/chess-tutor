"use client";

import { useState } from "react";
import GameList from "@/components/GameList";
import Lesson from "@/components/Lesson";
import UsernameForm from "@/components/UsernameForm";
import type { GameSummary, PlayerStats } from "@/lib/types";

interface GamesResponse {
  games: GameSummary[];
  stats: PlayerStats;
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GamesResponse | null>(null);
  const [selected, setSelected] = useState<GameSummary | null>(null);

  async function load(username: string) {
    setLoading(true);
    setError(null);
    setData(null);
    setSelected(null);
    try {
      const res = await fetch(`/api/games?user=${encodeURIComponent(username)}`);
      const body = (await res.json()) as GamesResponse | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error("error" in body ? body.error : `Request failed (${res.status})`);
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">AI Chess Coach</h1>
        <a href="/label" className="text-sm text-zinc-500 hover:text-emerald-400">
          Label moments
        </a>
      </div>

      {!selected && <UsernameForm onSubmit={load} disabled={loading} />}
      {loading && <p className="text-zinc-400">Loading games...</p>}
      {error && <p className="text-red-400">{error}</p>}

      {data && !selected && (
        <section className="flex flex-col gap-3">
          <p className="text-zinc-300">
            {data.stats.username}
            {" | "}
            Rapid {data.stats.rapid ?? "-"}
            {" | "}
            Blitz {data.stats.blitz ?? "-"}
            {" | "}
            Bullet {data.stats.bullet ?? "-"}
          </p>
          <GameList games={data.games} onSelect={setSelected} />
        </section>
      )}

      {selected && (
        <section className="flex flex-col gap-3">
          <button
            onClick={() => setSelected(null)}
            className="self-start text-sm text-emerald-400 hover:underline"
          >
            Back to games
          </button>
          <p className="text-zinc-300">
            {selected.white.username} ({selected.white.rating}) vs {selected.black.username} (
            {selected.black.rating})
            {selected.opening ? ` | ${selected.opening}` : ""}
          </p>
          <Lesson game={selected} />
        </section>
      )}
    </main>
  );
}
