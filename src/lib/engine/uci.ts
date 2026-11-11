/**
 * Transport-agnostic UCI driver. The transport is anything that can send a
 * line to Stockfish and hand lines back (a Node module or a Web Worker), so
 * the same analysis code runs in `scripts/` and in the browser.
 */
import { Chess } from "chess.js";
import type { EngineLine } from "./types";

export interface UciTransport {
  send(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate(): void;
}

export interface RawLine {
  multipv: number;
  /** Score from the side to move's point of view. */
  cp: number;
  mate: number | null;
  /** UCI moves. */
  pv: string[];
}

export const MATE_CP = 10000;

export function parseInfo(line: string): RawLine | null {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;
  if (/\b(lowerbound|upperbound)\b/.test(line)) return null;
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  const cpM = line.match(/\bscore cp (-?\d+)/);
  const mateM = line.match(/\bscore mate (-?\d+)/);
  let cp: number;
  let mate: number | null = null;
  if (mateM) {
    mate = Number(mateM[1]);
    cp = mate > 0 ? MATE_CP : -MATE_CP;
  } else if (cpM) {
    cp = Number(cpM[1]);
  } else {
    return null;
  }
  const pv = line.slice(line.indexOf(" pv ") + 4).trim().split(/\s+/);
  return { multipv, cp, mate, pv };
}

/** UCI move list -> SAN list from `fen`; stops at the first illegal move. */
export function pvToSan(fen: string, uci: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const m of uci) {
    try {
      const mv = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      out.push(mv.san);
    } catch {
      break;
    }
  }
  return out;
}

export function sideToMoveIsUser(fen: string, userIsWhite: boolean): boolean {
  return (fen.split(" ")[1] === "w") === userIsWhite;
}

export class UciEngine {
  private queue: ((line: string) => boolean)[] = [];
  private ready: Promise<void>;

  constructor(private readonly t: UciTransport) {
    t.onLine((line) => {
      const h = this.queue[0];
      if (h && h(line)) this.queue.shift();
    });
    this.ready = this.waitFor(/^uciok/, "uci").then(() => this.sync());
  }

  private waitFor(re: RegExp, cmd?: string, collect?: (line: string) => void): Promise<string> {
    return new Promise((resolve) => {
      this.queue.push((line) => {
        collect?.(line);
        if (re.test(line)) {
          resolve(line);
          return true;
        }
        return false;
      });
      if (cmd) this.t.send(cmd);
    });
  }

  private async sync() {
    await this.waitFor(/^readyok/, "isready");
  }

  async setOption(name: string, value: string | number) {
    await this.ready;
    this.t.send(`setoption name ${name} value ${value}`);
    await this.sync();
  }

  /**
   * Search `fen` to `depth`. Returns the final line per MultiPV slot, best
   * first, with evals from the side to move's point of view.
   */
  async search(fen: string, depth: number, multipv = 1): Promise<RawLine[]> {
    await this.ready;
    if (new Chess(fen).isGameOver()) return [];
    await this.setOption("MultiPV", multipv);
    this.t.send(`position fen ${fen}`);
    const best = new Map<number, RawLine>();
    await this.waitFor(/^bestmove/, `go depth ${depth}`, (line) => {
      const info = parseInfo(line);
      if (info) best.set(info.multipv, info);
    });
    return [...best.values()].sort((a, b) => a.multipv - b.multipv);
  }

  /** `search` converted to the coach's shape: SAN, user's POV. */
  async lines(
    fen: string,
    depth: number,
    multipv: number,
    userIsWhite: boolean,
  ): Promise<EngineLine[]> {
    const raw = await this.search(fen, depth, multipv);
    const sign = sideToMoveIsUser(fen, userIsWhite) ? 1 : -1;
    return raw
      .map((r) => {
        const pv = pvToSan(fen, r.pv);
        return {
          move: pv[0],
          evalCp: sign * r.cp,
          mate: r.mate === null ? null : sign * r.mate,
          pv,
        };
      })
      .filter((l) => l.move !== undefined);
  }

  terminate() {
    this.t.terminate();
  }
}
