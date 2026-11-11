// Copies the single-threaded lite Stockfish build into public/ so the browser can load it as a Worker.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

const require = createRequire(import.meta.url);
const src = require("stockfish").findEngine("lite-single");
const dest = join("public", "stockfish");
mkdirSync(dest, { recursive: true });
for (const ext of [".js", ".wasm"]) {
  const f = src.replace(/\.js$/, ext);
  copyFileSync(f, join(dest, basename(f)));
}
console.log(`Copied engine to ${dest}/`);
