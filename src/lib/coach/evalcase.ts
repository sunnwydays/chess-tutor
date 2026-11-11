import type { MomentAnalysis } from "@/lib/engine/types";
import type { MomentLabel } from "@/lib/moments";
import type { GameContext, PlayerContext } from "./schema";

/** Ground truth from /label, copied into the case so the eval never needs localStorage. */
export interface CaseLabel {
  momentType?: MomentLabel["momentType"];
  /** Engine line SAN -> idea group letter. Same letter = same idea. */
  lineGroups?: Record<string, string>;
  idea?: string;
  opponentMotif?: string;
  zone?: string[];
  tags?: string[];
  awareness?: MomentLabel["awareness"];
  /** What the player would play cold, before seeing the engine ("guess: <SAN>" in the notes). */
  humanGuess?: string;
  notes?: string;
}

/** One frozen position in evals/cases.json: a CoachRequest minus the stage, plus labels. */
export interface EvalCase {
  id: string;
  /** Why it is in the set (phase, color, drop size, ...). */
  tags: string[];
  game: GameContext & { id: string; url: string };
  moment: MomentAnalysis;
  player: PlayerContext;
  /** The move used at the attempt rung (the played move, or the human guess when labelled). */
  attempt: string;
  label?: CaseLabel;
}
