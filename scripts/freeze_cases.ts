/**
 * Freeze eval cases: picks moments from evals/moments_<user>.json, merges the
 * /label page's labels (evals/labels_<user>.json, the "Copy labels" JSON) and
 * writes evals/cases.json. Rerun after labels change.
 * Run: npx tsx scripts/freeze_cases.ts [user]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

function humanGuess(notes: string | undefined): string | undefined {
  const m = notes?.match(/guess:\s*([A-Za-z0-9+#=-]+)/);
  return m?.[1];
}

function main() {
  const user = (process.argv[2] ?? "sunnwy").toLowerCase();
  const moments = JSON.parse(readFileSync(`evals/moments_${user}.json`, "utf8")) as MomentRecord[];
  const labelsPath = `evals/labels_${user}.json`;
  const labels = existsSync(labelsPath)
    ? (JSON.parse(readFileSync(labelsPath, "utf8")) as Record<string, MomentLabel>)
    : {};
  if (!existsSync(labelsPath)) console.error(`no ${labelsPath}; cases get no labels`);

  const byId = new Map(moments.map((m) => [m.id, m]));
  const cases: EvalCase[] = [];
  for (const [id, tags] of Object.entries(PICKS)) {
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
            humanGuess: humanGuess(lab.notes),
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
