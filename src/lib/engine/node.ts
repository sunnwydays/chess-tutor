/** Node transport: the `stockfish` npm package in-process (scripts and evals). */
import { createRequire } from "node:module";
import { UciEngine, type UciTransport } from "./uci";

interface SfModule {
  processCommand(cmd: string): void;
  terminate(): void;
}

export function createNodeEngine(): UciEngine {
  const require = createRequire(import.meta.url);
  const init = require("stockfish") as (flavor: string, cb: (line: string) => void) => SfModule;
  let handler: (line: string) => void = () => {};
  // The engine module treats process.argv.slice(2) as its own CLI arguments
  // and reads them asynchronously after init, so the script's args must stay
  // hidden for the rest of the process. Read your args BEFORE calling this.
  process.argv = process.argv.slice(0, 2);
  const sf = init("lite-single", (line) => handler(line));
  const t: UciTransport = {
    send: (cmd) => sf.processCommand(cmd),
    onLine: (cb) => {
      handler = cb;
    },
    terminate: () => sf.terminate(),
  };
  return new UciEngine(t);
}
