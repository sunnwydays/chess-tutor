import { Chess } from "chess.js";

export interface ParsedMove {
  san: string;
  /** Position after the move. */
  fen: string;
}

export function parseMoves(pgn: string): ParsedMove[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true }).map((m) => ({ san: m.san, fen: m.after }));
}

/** The `%clk` string (e.g. "0:02:59.9") for each ply, if present. */
export function clocks(pgn: string): (string | undefined)[] {
  const movetext = pgn.replace(/^\[.*\]\s*$/gm, "");
  const out: (string | undefined)[] = [];
  // Tokens: {comment} or a move number / SAN move.
  const re = /\{([^}]*)\}|([KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)[+#]?[!?]*(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(movetext)) !== null) {
    if (m[2] !== undefined) {
      out.push(undefined);
    } else if (m[1] !== undefined && out.length > 0) {
      const clk = m[1].match(/%clk\s+([\d:.]+)/);
      if (clk) out[out.length - 1] = clk[1];
    }
  }
  return out;
}
