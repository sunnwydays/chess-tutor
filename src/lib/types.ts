export interface PlayerSide {
  username: string;
  rating: number;
}

export interface GameSummary {
  id: string;
  url: string;
  endTime: number;
  timeClass: string;
  white: PlayerSide;
  black: PlayerSide;
  /** From the user's perspective. */
  result: "win" | "loss" | "draw";
  userColor: "white" | "black";
  opening?: string;
  pgn: string;
}

export interface PlayerStats {
  username: string;
  rapid?: number;
  blitz?: number;
  bullet?: number;
}
