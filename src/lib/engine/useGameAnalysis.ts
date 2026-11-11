"use client";

/**
 * Runs Stockfish in a Web Worker over one game and returns the critical
 * moments. Results are cached in localStorage per game id so re-opening a
 * game is instant. The analysis options are part of the cache key.
 */
import { useEffect, useRef, useState } from "react";
import { analyzeGame, type AnalyzeOptions, type GameAnalysis } from "./analyze";
import { createBrowserEngine } from "./browser";
import type { UciEngine } from "./uci";

const CACHE_VERSION = 2;
const OPTIONS: AnalyzeOptions = { scanDepth: 10, deepDepth: 14, multipv: 5, minDrop: 10, maxMoments: 3 };

export type AnalysisState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "done"; analysis: GameAnalysis; cached: boolean }
  | { status: "error"; message: string };

function cacheKey(gameId: string): string {
  return `analysis:v${CACHE_VERSION}:mpv${OPTIONS.multipv}:${gameId}`;
}

function readCache(gameId: string): GameAnalysis | null {
  try {
    const raw = localStorage.getItem(cacheKey(gameId));
    return raw ? (JSON.parse(raw) as GameAnalysis) : null;
  } catch {
    return null;
  }
}

function writeCache(gameId: string, analysis: GameAnalysis) {
  try {
    localStorage.setItem(cacheKey(gameId), JSON.stringify(analysis));
  } catch {}
}

export function useGameAnalysis(gameId: string, moves: string[], userColor: "white" | "black"): AnalysisState {
  const [state, setState] = useState<AnalysisState>({ status: "idle" });
  const engineRef = useRef<UciEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache(gameId);
    if (cached) {
      setState({ status: "done", analysis: cached, cached: true });
      return;
    }
    setState({ status: "running", done: 0, total: moves.length + 1 });
    const engine = createBrowserEngine();
    engineRef.current = engine;
    analyzeGame(engine, moves, userColor, {
      ...OPTIONS,
      onProgress: (done, total) => {
        if (!cancelled) setState({ status: "running", done, total });
      },
    })
      .then((analysis) => {
        if (cancelled) return;
        writeCache(gameId, analysis);
        setState({ status: "done", analysis, cached: false });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => engine.terminate());
    return () => {
      cancelled = true;
      engine.terminate();
      engineRef.current = null;
    };
  }, [gameId, moves, userColor]);

  return state;
}
