# AI chess coach

Enter a Chess.com username, pick a recent game, and a coach walks you through the 1-3 moments where your own moves cost the most, with a hint ladder instead of the answer. Moments you needed help on come back later in a Review tab, each time with less help.

Stockfish judges every move, Claude only explains, and code checks every reply before you see it. Design notes: [design_decisions/DESIGN.md](design_decisions/DESIGN.md).

## Run

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npm run dev          # http://localhost:3000
```

Stockfish runs in the browser (WASM worker), so there is nothing else to install.

## Pages

| Page | What it does |
|---|---|
| `/` Lessons | Username -> recent games -> engine scan with progress -> 1-3 critical moments. Play a move, then climb the ladder: where to look -> what they threaten -> which piece -> the move -> explain. |
| `/review` | Spaced repetition on a virtual clock. "Skip to the future" jumps to the next due date. A session is up to 4 reps. |
| `/label` | Label the scanned moments (idea, zone, opponent motif, engine line groups). These labels are the eval ground truth. Control positions get a single "does this look critical?" question. |

## Review flow

A lesson moment that ends with any hint used goes into the queue (box 0). Each review starts lower on the assistance dial:

| Box | Level | Form |
|---|---|---|
| 0, first time | 5 | Position plus the moves that led to it, full ladder |
| 0, after a miss | 4 | Position only, full ladder |
| 1 | 1 | **Explain the idea** in a line, no move. Haiku extracts claims, code grades idea / zone / opponent motif against the label: incorrect, missing details or correct. One follow-up question on the weakest part, then the ladder starts at 2, 3 or 4 based on the grade. |
| 2 | 0 | **Find the moment**: step through 6-12 moves with no eval and click the move you'd take back, or "nothing wrong". Then the ladder at that position. |

Every session also has one control stream where "nothing wrong" is the right answer. A success moves the item up a box (due in 1 day, then 3, then learned); a miss sends it back to box 0. To stop you memorizing, the original position is shown once. After that you get a sibling (another of your moments with the same motif tag, taken from the labels), and failing that the original with colors swapped.

Box 1 falls back to level 2 (one try, no hints) when the moment has no labelled idea. Box 2 falls back to level 2 when there is no scan record to build a stream from. "Add my labelled moments" puts every labelled scan moment into the queue for a demo.

Every attempt, rung, form answer and rep is logged as one JSONL row to `logs/interactions.jsonl` (`mode`, `level`, `hintsTaken`, `msToFirstAttempt`, `positionKind`, `virtualClock`, ...).

## Evals and tests

```bash
npm test                  # unit tests: queue, streams, rubric, session rules, color swap
npm run eval              # coach ladder over evals/cases.json (39 frozen moments), Haiku judge + leak guess
npm run eval-rubric       # Form A grader vs hand grades (evals/rubric_cases.json)
npx tsc --noEmit
```

Latest coach eval (39 cases, `evals/run_review_integration.json`) vs the first run of the six-rung ladder (`evals/redesign_v1.json`). The changes in between: the prompt asks for ~20% fewer words than the validator allows, lists the opponent's legal captures and checks for threat arrows, and bans eval numbers at the attempt rung.

| Rung | Fallback (before -> now) | Needed a retry | Judge: names the idea | Judge: depth fits rating |
|---|---|---|---|---|
| attempt | 0% -> 0% | 5% -> 10% | 36% -> 51% | 59% -> 72% |
| focus | 13% -> 3% | 77% -> 36% | 88% -> 89% | 91% -> 84% |
| threat | 21% -> 0% | 85% -> 13% | 84% -> 87% | 90% -> 95% |
| piece | 31% -> 3% | 92% -> 5% | 81% -> 71% | 81% -> 74% |
| move | 0% -> 3% | 10% -> 15% | 97% -> 97% | 95% -> 92% |
| explain | 0% -> 0% | 23% -> 21% | 100% -> 97% | 92% -> 95% |

Leak checks pass on 100% of replies. The leak guess (Haiku guessing the best move from the hints shown so far) climbs from 15% on the bare position to 31 / 33 / 41 / 59% across attempt -> piece, and 97% at move. Form A grader agreement with hand grades: 30/32 (94%). Still weak: the attempt reply names the idea only half the time, and half the explain replies pad past three points (judge "forced style").

## Layout

- `src/app/` pages; `api/games` (Chess.com proxy), `api/coach` (ladder replies), `api/review/grade` (Form A), `api/log`, `api/moments` (scan file)
- `src/lib/engine/` Stockfish driver, game analysis, idea grouping and hint squares
- `src/lib/coach/` prompt, schema, validation, engine verdicts
- `src/lib/review/` queue (Leitner), streams (Form B), rubric + extract (Form A), sources (labels, siblings, color swap), session rules
- `src/components/` board, lesson, moment panel (ladder), idea question, find the moment
- `evals/`, `scripts/` eval cases, moment scan, eval runners
