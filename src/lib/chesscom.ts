import type { GameSummary, PlayerStats } from "./types";

const BASE = "https://api.chess.com/pub/player";
const HEADERS = {
  "User-Agent": "ai-chess-coach-takehome",
  Accept: "application/json",
};

export class UnknownUserError extends Error {
  constructor(username: string) {
    super(`Chess.com user "${username}" was not found`);
    this.name = "UnknownUserError";
  }
}

interface RawPlayer {
  username: string;
  rating: number;
  result: string;
}

interface RawGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  white: RawPlayer;
  black: RawPlayer;
}

type RawStats = Record<string, { last?: { rating?: number } } | undefined>;

const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

async function getJson<T>(url: string, username: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404) throw new UnknownUserError(username);
    if (!res.ok) throw new Error(`Chess.com returned HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Chess.com request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function mapResult(userResult: string): GameSummary["result"] {
  if (userResult === "win") return "win";
  if (DRAW_RESULTS.has(userResult)) return "draw";
  return "loss";
}

function openingFromPgn(pgn: string): string | undefined {
  const m = pgn.match(/\[ECOUrl "([^"]+)"\]/);
  if (!m) return undefined;
  const last = m[1].split("/").pop();
  return last ? last.replace(/-/g, " ") : undefined;
}

function toSummary(raw: RawGame, username: string): GameSummary | null {
  if (!raw.pgn) return null;
  const userColor =
    raw.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
  const me = userColor === "white" ? raw.white : raw.black;
  return {
    id: raw.url.split("/").pop() ?? raw.url,
    url: raw.url,
    endTime: raw.end_time,
    timeClass: raw.time_class,
    white: { username: raw.white.username, rating: raw.white.rating },
    black: { username: raw.black.username, rating: raw.black.rating },
    result: mapResult(me.result),
    userColor,
    opening: openingFromPgn(raw.pgn),
    pgn: raw.pgn,
  };
}

export async function fetchRecentGames(username: string, limit = 20): Promise<GameSummary[]> {
  const name = encodeURIComponent(username.toLowerCase());
  const { archives } = await getJson<{ archives: string[] }>(
    `${BASE}/${name}/games/archives`,
    username,
  );
  const games: GameSummary[] = [];
  for (const url of [...archives].reverse().slice(0, 2)) {
    const { games: raws } = await getJson<{ games: RawGame[] }>(url, username);
    const mapped = [...raws]
      .sort((a, b) => b.end_time - a.end_time)
      .map((g) => toSummary(g, username))
      .filter((g): g is GameSummary => g !== null);
    games.push(...mapped);
    if (games.length >= limit) break;
  }
  return games.slice(0, limit);
}

export async function fetchStats(username: string): Promise<PlayerStats> {
  const name = encodeURIComponent(username.toLowerCase());
  const raw = await getJson<RawStats>(`${BASE}/${name}/stats`, username);
  return {
    username,
    rapid: raw.chess_rapid?.last?.rating,
    blitz: raw.chess_blitz?.last?.rating,
    bullet: raw.chess_bullet?.last?.rating,
  };
}
