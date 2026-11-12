/**
 * Freeze eval cases: picks moments from evals/moments_<user>.json, merges the
 * /label page's labels (evals/labels_<user>.json or ./labels.json, the "Copy
 * labels" JSON: an array, or an id-keyed object) and writes evals/cases.json.
 * Cases = PICKS plus every labelled moment not marked useful "no".
 * Rerun after labels change.
 * Run: npx tsx scripts/freeze_cases.ts [user]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Chess } from "chess.js";
import type { MomentLabel, MomentRecord } from "@/lib/moments";
import type { EvalCase } from "@/lib/coach/evalcase";

/** Moment id -> why it is in the set. Coverage: phases, colors, drop sizes, repeats, engine disagreements. */
const PICKS: Record<string, string[]> = {
  "186303160024-11": ["opening", "white", "medium-drop", "only-move?"],
  "186284283824-19": ["opening", "white", "medium-drop"],
  "186179104426-4": ["opening", "black", "small-drop", "many-good"],
  "186179104426-16": ["opening", "black", "large-drop", "only-move?"],
  "186044354642-14": ["opening", "black", "medium-drop", "many-good"],
  "186756902744-37": ["middlegame", "white", "large-drop", "many-good"],
  "186303889154-32": ["middlegame", "black", "large-drop", "many-good"],
  "186180087086-51": ["middlegame", "white", "large-drop", "many-good"],
  "186131276790-51": ["middlegame", "white", "large-drop", "only-move?"],
  "186130710148-50": ["middlegame", "black", "small-drop", "engine-disagreement?"],
  "186058301434-59": ["middlegame", "white", "large-drop", "only-move?"],
  "186044354642-24": ["middlegame", "black", "large-drop", "only-move?"],
  "186303160024-109": ["endgame", "white", "large-drop", "only-move?"],
  "186179398940-64": ["endgame", "black", "large-drop", "repeated-motif"],
  "186179398940-70": ["endgame", "black", "large-drop", "repeated-motif"],
  "186125417660-63": ["endgame", "white", "medium-drop", "many-good"],
  "186043154612-65": ["endgame", "white", "large-drop"],
  "186131276790-63": ["endgame", "white", "small-drop", "engine-disagreement?"],
};

/**
 * The player's cold guess as legal SAN. Reads the label's `guess` ("Qe2, to
 * move the queen...") or "guess: <SAN>" in notes. Partial captures like "xe4"
 * resolve when exactly one legal move matches.
 */
function humanGuess(lab: MomentLabel, fen: string): string | undefined {
  const raw = lab.guess?.match(/^\s*([A-Za-z0-9+#=-]+)/)?.[1] ?? lab.notes?.match(/guess:\s*([A-Za-z0-9+#=-]+)/)?.[1];
  if (!raw) return undefined;
  const legal = new Chess(fen).moves();
  const strip = (x: string) => x.replace(/[+#]/g, "");
  const exact = legal.find((m) => strip(m) === strip(raw));
  if (exact) return exact;
  const partial = legal.filter((m) => strip(m).endsWith(strip(raw)));
  return partial.length === 1 ? partial[0] : undefined;
}

function main() {
  const user = (process.argv[2] ?? "sunnwy").toLowerCase();
  const moments = JSON.parse(readFileSync(`evals/moments_${user}.json`, "utf8")) as MomentRecord[];
  const labelsPath = [`evals/labels_${user}.json`, "labels.json"].find((p) => existsSync(p));
  const rawLabels = labelsPath ? (JSON.parse(readFileSync(labelsPath, "utf8")) as MomentLabel[] | Record<string, MomentLabel>) : {};
  const labels: Record<string, MomentLabel> = Array.isArray(rawLabels)
    ? Object.fromEntries(rawLabels.map((l) => [l.id, l]))
    : rawLabels;
  if (!labelsPath) console.error("no labels file; cases get no labels");
  const picks: Record<string, string[]> = { ...PICKS };
  for (const [id, lab] of Object.entries(labels)) {
    if (!picks[id] && lab.useful !== "no") picks[id] = ["labelled", ...(lab.tags ?? [])];
  }

  const byId = new Map(moments.map((m) => [m.id, m]));
  const cases: EvalCase[] = [];
  for (const [id, tags] of Object.entries(picks)) {
    const rec = byId.get(id);
    if (!rec) {
      console.error(`missing moment ${id}`);
      continue;
    }
    const lab = labels[id];
    const { moves, ...game } = rec.game;
    const rating = game.userColor === "white" ? game.white.rating : game.black.rating;
    cases.push({
      id,
      tags,
      game: { ...game, moves },
      moment: rec.moment,
      player: { rating },
      attempt: rec.moment.played,
      label: lab
        ? {
            momentType: lab.momentType,
            lineGroups: lab.lineGroups,
            idea: lab.idea,
            opponentMotif: lab.opponentMotif,
            zone: lab.zone,
            tags: lab.tags,
            awareness: lab.awareness,
            humanGuess: humanGuess(lab, rec.moment.fenBefore),
            notes: lab.notes,
          }
        : undefined,
    });
  }
  writeFileSync("evals/cases.json", JSON.stringify(cases, null, 2) + "\n");
  const labelled = cases.filter((c) => c.label).length;
  console.error(`wrote ${cases.length} cases (${labelled} labelled) to evals/cases.json`);
}

main();
