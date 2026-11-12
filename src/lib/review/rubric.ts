/**
 * Form A, "explain the idea" (assistance level 1). The player writes a
 * sentence or two: what is the plan, where, and what is the opponent up to.
 *
 * Extract-then-compare, so the model never decides correctness:
 *   1. extractClaims(): Haiku turns the answer into JSON claims; squares and
 *      piece references that fail chess.js are dropped.
 *   2. scoreClaims(): pure code scores idea / zone / opponent motif against
 *      the /label ground truth as hit / partial / miss.
 *   3. grade(): fixed rule -> correct / missing-details / incorrect.
 * See design_decisions/SPACED_REPETITION.md, Form A.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Chess, type Square } from "chess.js";

export const RUBRIC_MODEL = "claude-haiku-5-5";
export const RUBRIC_PROMPT_VERSION = "rubric-v1";

export interface Claims {
  /** Plans or motifs the player names, in their words. */
  ideas: string[];
  /** Squares mentioned, directly or via a piece ("the knight on f6" -> f6). */
  squares: string[];
  /** Piece references as `<Piece><square>`, e.g. "Nf6". Validated against the position. */
  pieces: string[];
  /** What the player says the opponent threatens or relies on. */
  opponentThreats: string[];
}

/** The three ground-truth fields from MomentLabel that the rubric uses. */
export interface RubricLabel {
  idea?: string;
  zone?: string[];
  opponentMotif?: string;
}

export type DimScore = "hit" | "partial" | "miss" | "n/a";
export interface RubricScores {
  idea: DimScore;
  zone: DimScore;
  opponentMotif: DimScore;
}
export type RubricGrade = "correct" | "missing-details" | "incorrect";

export const CLAIMS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas", "squares", "pieces", "opponentThreats"],
  properties: {
    ideas: { type: "array", items: { type: "string" } },
    squares: { type: "array", items: { type: "string" } },
    pieces: { type: "array", items: { type: "string" } },
    opponentThreats: { type: "array", items: { type: "string" } },
  },
} as const;

export const EXTRACT_SYSTEM_PROMPT = `You extract claims from a chess student's short answer about a position. You never judge whether the student is right.

Return JSON with:
- ideas: each plan, motif or goal the student states, one short phrase each (under 8 words), lowercase, in the student's own terms. Include the move they suggest as part of the phrase if they name one.
- squares: every board square the student mentions, in algebraic notation ("f6"). Include the squares of pieces they identify by square ("the knight on f6", "Nf6"). Do not guess squares for pieces named without a square.
- pieces: pieces the student identifies by square, as piece letter plus square ("Nf6", "Qd1"). Pawn is "P". Omit anything without a clear square.
- opponentThreats: what the student says the opponent is threatening, planning, or relying on, one short phrase each.

Empty arrays when the answer says nothing for a field. No commentary.`;

const SQUARE_RE = /^[a-h][1-8]$/;
const PIECE_RE = /^([KQRBNP])([a-h][1-8])$/;

/** Drop squares that are not squares and piece refs that are not on the board; fold piece squares into squares. */
export function validateClaims(raw: Claims, fen: string): Claims {
  let chess: Chess | null = null;
  try {
    chess = new Chess(fen);
  } catch {
    chess = null;
  }
  const squares = new Set<string>();
  for (const s of raw.squares ?? []) {
    const t = s.trim().toLowerCase();
    if (SQUARE_RE.test(t)) squares.add(t);
  }
  const pieces: string[] = [];
  for (const p of raw.pieces ?? []) {
    const t = p.trim();
    const m = t.match(PIECE_RE) ?? t.toUpperCase().match(PIECE_RE);
    if (!m) continue;
    const [, letter, sq] = m;
    const on = chess?.get(sq.toLowerCase() as Square);
    if (!on || on.type !== letter.toLowerCase()) continue;
    pieces.push(`${letter}${sq.toLowerCase()}`);
    squares.add(sq.toLowerCase());
  }
  return {
    ideas: (raw.ideas ?? []).map((s) => s.trim()).filter(Boolean),
    squares: [...squares],
    pieces,
    opponentThreats: (raw.opponentThreats ?? []).map((s) => s.trim()).filter(Boolean),
  };
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/** Haiku extracts; chess.js validates. Throws on API failure (caller decides the fallback). */
export async function extractClaims(answer: string, fen: string): Promise<Claims> {
  const side = fen.split(" ")[1] === "b" ? "Black" : "White";
  const res = await client().messages.create({
    model: RUBRIC_MODEL,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: CLAIMS_SCHEMA } },
    system: [{ type: "text", text: EXTRACT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Position (FEN): ${fen}\n${side} to move.\n\nStudent's answer:\n"""\n${answer.trim()}\n"""`,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("extraction refused");
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`no text block (stop_reason ${res.stop_reason})`);
  return validateClaims(JSON.parse(text) as Claims, fen);
}

/* ---------- scoring (pure) ---------- */

/** Motif vocabulary: tag -> words/phrases that mean it. Matched on normalized text. */
const MOTIFS: Record<string, string[]> = {
  pin: ["pin", "pinned", "pinning"],
  fork: ["fork", "forked", "forking", "double attack", "attacks both", "attacking both", "hits both"],
  skewer: ["skewer"],
  "discovered-attack": ["discovered", "discovery", "unmask", "uncover"],
  "back-rank": ["back rank", "backrank", "back-rank"],
  "hanging-piece": ["hanging", "loose", "en prise", "undefended", "unprotected", "free piece", "wins a piece", "win a piece", "drops"],
  "win-material": ["win material", "wins material", "win the", "wins the", "grab", "capture", "take the", "takes the", "exchange up"],
  overload: ["overload", "overworked", "overloaded"],
  deflection: ["deflect", "decoy", "lure"],
  "open-file": ["open file", "open the file", "file", "rook lift", "doubling rooks", "seventh rank"],
  "king-safety": ["king safety", "weak king", "exposed king", "king is open", "castle", "castling", "shelter"],
  attack: ["attack", "attacking", "mating attack", "assault", "storm"],
  mate: ["mate", "checkmate", "mating net", "mate threat"],
  check: ["check", "checks", "with check", "with tempo", "tempo"],
  "pawn-break": ["pawn break", "break", "push", "advance", "lever"],
  "passed-pawn": ["passed pawn", "passer", "promote", "promoting", "promotion", "queening", "queen the pawn"],
  "weak-square": ["weak square", "outpost", "hole"],
  "weak-pawn": ["weak pawn", "isolated", "backward pawn", "doubled pawns", "target the pawn"],
  trade: ["trade", "trades", "exchange", "exchanging", "swap", "simplify", "liquidate"],
  develop: ["develop", "development", "get the pieces out", "bring the pieces out"],
  centralize: ["centralize", "centralise", "center", "centre", "central"],
  defend: ["defend", "defence", "defense", "protect", "cover", "guard", "block", "hold"],
  escape: ["escape", "move the queen", "move the piece", "step away", "retreat", "get out", "out of the", "out of trouble", "save the", "rescue", "to safety"],
  activity: ["activate", "active", "activity", "improve the", "better square", "reroute"],
  space: ["space", "cramp", "restrict", "clamp"],
  zugzwang: ["zugzwang"],
  "bishop-pair": ["bishop pair", "two bishops"],
  endgame: ["endgame", "ending", "king activity", "opposition"],
  sacrifice: ["sacrifice", "sac", "give up the"],
  "trapped-piece": ["trap", "trapped", "no squares"],
  counterplay: ["counterplay", "counter-attack", "counterattack"],
  initiative: ["initiative", "pressure", "keep the pressure", "keep attacking"],
};

const STOP = new Set(
  "the a an and or of to in on at for with by is are was be it my his her their our your this that there here then so than into onto from not no can should would could will just also very really about which what who when where how i me we you they them he she its it's im i'm".split(
    " ",
  ),
);

/** Lowercase, strip punctuation except square names and piece letters, crude stemming. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'+#=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(w: string): string {
  if (w.length <= 4) return w;
  // "promote" and "promoting" both -> "promot".
  return w.replace(/(ing|ers|ed|es|s|ly)$/, "").replace(/e$/, "");
}

const PIECE_WORDS: Record<string, string> = {
  knight: "knight",
  knights: "knight",
  horse: "knight",
  bishop: "bishop",
  bishops: "bishop",
  rook: "rook",
  rooks: "rook",
  queen: "queen",
  king: "king",
  pawn: "pawn",
  pawns: "pawn",
};

/** Words that mean the same thing for matching ("hitting the knight" = "attacks the knight"). */
const SYNONYMS: Record<string, string> = {};
for (const [canon, words] of Object.entries({
  attack: "attack attacks attacking attacked hit hits hitting threaten threatens threatening eye eyes eyeing",
  defend: "defend defends defending defended protect protects protecting protected guard guards guarding guarded",
  capture: "capture captures capturing captured take takes taking win wins winning grab grabs",
  move: "move moves moving moved go goes put",
  opponent: "opponent opponent's opponents black white enemy",
})) {
  for (const w of words.split(" ")) SYNONYMS[w] = canon;
}

/** Content words of a phrase: stop words out, synonyms folded, crude stems, piece names kept whole. */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizeText(text).split(" ")) {
    if (!w || STOP.has(w)) continue;
    if (SQUARE_RE.test(w)) {
      out.add(w);
      continue;
    }
    if (PIECE_WORDS[w]) {
      out.add(PIECE_WORDS[w]);
      continue;
    }
    const m = w.match(/^([kqrbnp])([a-h][1-8])$/);
    if (m) {
      out.add(m[2]);
      out.add({ k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" }[m[1]] ?? "");
      continue;
    }
    out.add(SYNONYMS[w] ?? stem(w));
  }
  out.delete("");
  return out;
}

/** Motif tags found in free text. */
export function motifTags(text: string): Set<string> {
  const t = ` ${normalizeText(text)} `;
  const tags = new Set<string>();
  for (const [tag, words] of Object.entries(MOTIFS)) {
    if (words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `))) tags.add(tag);
  }
  return tags;
}

function overlap<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/**
 * Score a free-text label against the player's phrases. Hit: motif tags or
 * content words >= 0.6 overlap, or words >= 0.5 plus a shared tag. Partial needs a
 * shared motif tag or 2+ shared content words, so naming one piece ("a
 * tactic with the knight") earns nothing.
 */
export function textMatch(claims: string[], label: string | undefined, extraTokens: string[] = []): DimScore {
  if (!label || !label.trim()) return "n/a";
  if (!claims.some((c) => c.trim())) return "miss";
  const claimText = claims.join(". ");
  const labelTags = motifTags(label);
  const claimTags = motifTags(claimText);
  const labelTokens = contentTokens(label);
  const claimTokens = contentTokens(claimText);
  for (const t of extraTokens) claimTokens.add(t);
  const tagHits = overlap(labelTags, claimTags);
  const tokHits = overlap(labelTokens, claimTokens);
  const tagScore = labelTags.size ? tagHits / labelTags.size : 0;
  const tokScore = labelTokens.size ? tokHits / labelTokens.size : 0;
  if (Math.max(tagScore, tokScore) >= 0.6 || (tokScore >= 0.5 && tagHits > 0)) return "hit";
  if (tagHits > 0 || tokHits >= Math.min(2, labelTokens.size)) return "partial";
  return "miss";
}

/** Zone: fraction of the label's squares the player named. >= 0.5 (or 2+ squares) hit, any partial. */
export function zoneMatch(claimSquares: string[], zone: string[] | undefined): DimScore {
  const z = (zone ?? []).map((s) => s.toLowerCase()).filter((s) => SQUARE_RE.test(s));
  if (!z.length) return "n/a";
  const got = new Set(claimSquares.map((s) => s.toLowerCase()));
  const n = z.filter((s) => got.has(s)).length;
  if (n >= 2 || n / z.length >= 0.5) return "hit";
  if (n > 0) return "partial";
  return "miss";
}

export function scoreClaims(claims: Claims, label: RubricLabel): RubricScores {
  // Squares the player named count toward the idea too ("attack f7" vs "weak f7 square").
  const idea = textMatch(claims.ideas, label.idea, claims.squares);
  const zone = zoneMatch(claims.squares, label.zone);
  // The opponent's motif may be folded into the plan ("get out of the fork"):
  // a motif tag named in the ideas gives partial credit at most.
  let opponentMotif = textMatch(claims.opponentThreats, label.opponentMotif, claims.squares);
  if (opponentMotif === "miss" && label.opponentMotif) {
    const labelTags = motifTags(label.opponentMotif);
    const ideaTags = motifTags(claims.ideas.join(". "));
    if (overlap(labelTags, ideaTags) > 0) opponentMotif = "partial";
  }
  return { idea, zone, opponentMotif };
}

/** Fixed rule: idea miss -> incorrect; idea hit but zone or motif short -> missing-details; all hit -> correct. */
export function grade(scores: RubricScores): RubricGrade {
  if (scores.idea === "miss") return "incorrect";
  const ok = (d: DimScore) => d === "hit" || d === "n/a";
  if (ok(scores.idea) && ok(scores.zone) && ok(scores.opponentMotif)) return "correct";
  return "missing-details";
}

export type RubricDimension = keyof RubricScores;

/** The dimension a follow-up should target: weakest first, idea before zone before motif on ties. */
export function weakestDimension(scores: RubricScores): RubricDimension | null {
  const rank: Record<DimScore, number> = { miss: 0, partial: 1, hit: 2, "n/a": 3 };
  const order: RubricDimension[] = ["idea", "zone", "opponentMotif"];
  let best: RubricDimension | null = null;
  for (const d of order) {
    if (rank[scores[d]] >= 2) continue;
    if (best === null || rank[scores[d]] < rank[scores[best]]) best = d;
  }
  return best;
}

/**
 * One follow-up question aimed at the weakest dimension, or null when the
 * answer already hit everything. Written from templates so nothing about
 * the answer leaks: it points at the gap, never at the content.
 */
export function followUpQuestion(scores: RubricScores): string | null {
  const dim = weakestDimension(scores);
  if (!dim) return null;
  const sawIdea = scores.idea === "hit" || scores.idea === "partial";
  switch (dim) {
    case "idea":
      return scores.idea === "partial"
        ? "You have part of the plan. In one sentence, what is the move actually trying to achieve?"
        : "What is the main goal for your side in this position, in one sentence?";
    case "zone":
      return sawIdea
        ? "Good, that is the plan. Which squares or pieces does it revolve around? Name one or two."
        : "Which squares or pieces matter most here? Name one or two.";
    case "opponentMotif":
      return sawIdea
        ? "You saw the plan. What is your opponent threatening, or relying on, right now?"
        : "What is your opponent threatening or relying on right now?";
  }
}

/** Ladder start after Form A (SPACED_REPETITION.md): correct 2, missing-details 3, incorrect 4. */
export function ladderLevelFor(g: RubricGrade): 2 | 3 | 4 {
  return g === "correct" ? 2 : g === "missing-details" ? 3 : 4;
}

/** A second answer can raise the grade by one step at most. */
export function regrade(first: RubricGrade, second: RubricGrade): RubricGrade {
  const order: RubricGrade[] = ["incorrect", "missing-details", "correct"];
  const a = order.indexOf(first);
  const b = order.indexOf(second);
  return order[Math.max(a, Math.min(b, a + 1))];
}
