/**
 * Form A rubric eval: for each frozen player answer in evals/rubric_cases.json,
 * extract claims with Haiku, score with the pure rubric, and compare the
 * grade to the hand grade. Target agreement >= 90%.
 * Run: npm run eval-rubric [-- --verbose]
 */
import { readFileSync } from "node:fs";
import {
  extractClaims,
  followUpQuestion,
  grade,
  scoreClaims,
  type Claims,
  type RubricGrade,
  type RubricLabel,
} from "@/lib/review/rubric";

// Load .env (ANTHROPIC_API_KEY) without a dependency.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env, rely on the environment
}

interface CaseFile {
  moments: {
    momentId: string;
    labelSource?: string;
    fen: string;
    label: RubricLabel;
    answers: { id: string; answer: string; expected: RubricGrade }[];
  }[];
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const file = JSON.parse(readFileSync("evals/rubric_cases.json", "utf8")) as CaseFile;
  let total = 0;
  let agree = 0;
  const confusion: Record<string, number> = {};
  for (const m of file.moments) {
    console.log(`\n${m.momentId}${m.labelSource ? ` (label: ${m.labelSource})` : ""}`);
    for (const a of m.answers) {
      total++;
      let claims: Claims;
      try {
        claims = await extractClaims(a.answer, m.fen);
      } catch (err) {
        console.log(`  ${a.id}  EXTRACT FAILED: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const scores = scoreClaims(claims, m.label);
      const g = grade(scores);
      const ok = g === a.expected;
      if (ok) agree++;
      confusion[`${a.expected} -> ${g}`] = (confusion[`${a.expected} -> ${g}`] ?? 0) + 1;
      console.log(
        `  ${a.id}  ${ok ? "ok  " : "MISS"} expected ${a.expected.padEnd(15)} got ${g.padEnd(15)} idea=${scores.idea} zone=${scores.zone} motif=${scores.opponentMotif}`,
      );
      if (verbose || !ok) {
        console.log(`        answer: ${a.answer}`);
        console.log(`        claims: ${JSON.stringify(claims)}`);
        const q = followUpQuestion(scores);
        if (q) console.log(`        follow-up: ${q}`);
      }
    }
  }
  const pct = total ? Math.round((100 * agree) / total) : 0;
  console.log(`\nAgreement: ${agree}/${total} = ${pct}% (target >= 90%)`);
  for (const [k, v] of Object.entries(confusion).sort()) console.log(`  ${k}: ${v}`);
  if (pct < 90) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
