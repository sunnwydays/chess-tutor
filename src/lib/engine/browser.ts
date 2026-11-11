/**
 * Browser transport: the single-threaded lite WASM build as a Web Worker.
 * The engine file is copied to public/stockfish/ by scripts/copy_engine.mjs.
 */
import { UciEngine, type UciTransport } from "./uci";

export const ENGINE_URL = "/stockfish/stockfish-19-lite-single.js";

export function createBrowserEngine(): UciEngine {
  const worker = new Worker(ENGINE_URL);
  const t: UciTransport = {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => {
      worker.onmessage = (e: MessageEvent<string>) => cb(String(e.data));
    },
    terminate: () => worker.terminate(),
  };
  return new UciEngine(t);
}
