/**
 * Pure-function checks of src/lib/engine/ideas.ts against the /label ground truth
 * carried in each eval case (lineGroups, momentType). Used by scripts/eval.ts.
 */
import type { EvalCase } from "@/lib/coach/evalcase";
import { groupLines, momentType } from "@/lib/engine/ideas";

export interface PureResult {
  name: string;
  /** null = informational only (no ground truth for this case). */
  pass: boolean | null;
  detail: string;
}

/** Do two labelings partition the lines the same way? Compared pairwise so letter names don't matter. */
function samePartition(a: Record<string, string>, b: Record<string, string>): { ok: boolean; pairs: number; agree: number } {
  const keys = Object.keys(a).filter((k) => k in b);
  let pairs = 0;
  let agree = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      pairs++;
      if ((a[keys[i]] === a[keys[j]]) === (b[keys[i]] === b[keys[j]])) agree++;
    }
  }
  return { ok: pairs === agree, pairs, agree };
}

export function checkIdeas(c: EvalCase): PureResult[] {
  const out: PureResult[] = [];
  const predicted = groupLines(c.moment);
  const type = momentType(c.moment);
  if (c.label?.lineGroups && Object.keys(c.label.lineGroups).length) {
    const r = samePartition(predicted, c.label.lineGroups);
    out.push({
      name: "idea grouping matches label",
      pass: r.ok,
      detail: `${r.agree}/${r.pairs} pairs; predicted ${JSON.stringify(predicted)} label ${JSON.stringify(c.label.lineGroups)}`,
    });
  } else {
    out.push({ name: "idea grouping (unlabelled)", pass: null, detail: JSON.stringify(predicted) });
  }
  if (c.label?.momentType) {
    out.push({ name: "moment type matches label", pass: type === c.label.momentType, detail: `${type} vs ${c.label.momentType}` });
  } else {
    out.push({ name: "moment type (unlabelled)", pass: null, detail: type });
  }
  return out;
}
