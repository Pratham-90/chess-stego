// Chess rules for the codec: a thin wrapper around the chess.js library.
//
// The Python version uses python-chess. For the two versions to understand each
// other's games, this file must produce exactly the same list of legal moves,
// in exactly the same order (sorted by UCI string, e.g. "e2e4").
//
// We call a few of chess.js's internal methods (the ones starting with "_").
// Its public `moves({verbose: true})` builds a lot of extra information per
// move and is about 30x slower, which matters for files with 100,000 moves.
// The library is pinned and copied into vendor/, so this cannot silently break.
import { Chess } from "../vendor/chess.js";

const FILES = "abcdefgh";

// chess.js stores a square as one number: row * 16 + column, where row 0 is rank 8.
const squareName = (sq) => FILES[sq & 15] + (8 - (sq >> 4));

// UCI notation: from-square + to-square (+ promotion piece), e.g. "e7e8q".
const uciOf = (move) => squareName(move.from) + squareName(move.to) + (move.promotion ?? "");

export class Game {
  constructor() {
    this.chess = new Chess();
    this.sans = []; // moves in standard notation ("Nf3"), for the PGN file
    this.ucis = []; // the same moves in UCI notation ("g1f3"), for the 3D board
    this.seen = new Map(); // position -> how many times it has occurred
    this.options = null;
    this.#afterMove();
  }

  get plies() {
    return this.ucis.length;
  }

  // Legal moves in the agreed order. Each option is { uci, raw }.
  #afterMove() {
    this.legal = this.chess._moves({ legal: true });
    this.options = this.legal
      .map((raw) => ({ uci: uciOf(raw), raw }))
      .sort((a, b) => (a.uci < b.uci ? -1 : 1));
    // A FEN string describes a position. Its first four fields (pieces, side
    // to move, castling rights, en passant square) identify the position for
    // the repetition rule; the fifth counts moves since a capture or pawn move.
    const fen = this.chess.fen().split(" ");
    this.placement = fen[0];
    this.halfmoveClock = Number(fen[4]);
    const key = fen.slice(0, 4).join(" ");
    this.repeats = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, this.repeats);
  }

  play(option) {
    this.sans.push(this.chess._moveToSan(option.raw, this.legal));
    this.ucis.push(option.uci);
    this.chess._makeMove(option.raw);
    this.#afterMove();
  }

  // Find the option that a move written in standard notation ("Nbd2",
  // "exd5", "O-O", "e8=Q+") refers to. Returns null if there is no such move.
  optionFromSan(san) {
    const text = san.replace(/[+#!?]+$/, ""); // check marks and annotations carry no information
    const castle = /^[O0]-[O0](-[O0])?$/.exec(text);
    if (castle) {
      // Castling is the only time a king moves two files: e -> g, or e -> c.
      const file = castle[1] ? "c" : "g";
      return this.options.find((o) => o.raw.piece === "k" && o.uci[0] === "e" && o.uci[2] === file) ?? null;
    }
    //                 piece      from-file from-rank    target        promotion
    const parts = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/.exec(text);
    if (!parts) return null;
    const [, piece = "P", file, rank, target, promotion = ""] = parts;
    const matches = this.options.filter((o) =>
      o.raw.piece === piece.toLowerCase() &&
      o.uci.slice(2, 4) === target &&
      (o.raw.promotion ?? "") === promotion.toLowerCase() &&
      (!file || o.uci[0] === file) &&
      (!rank || o.uci[1] === rank) &&
      // a pawn move written without a starting file ("e4") is never a capture
      (piece !== "P" || file || o.uci[0] === target[0]));
    return matches.length === 1 ? matches[0] : null;
  }

  isCheckmate() {
    return this.options.length === 0 && this.chess.isCheck();
  }

  // Same rules as python-chess's board.is_game_over(): checkmate, stalemate,
  // not enough pieces to mate, 75 moves without progress, or the same
  // position five times. (Only the encoder uses this, to decide when to
  // start a new game; the decoder simply replays whatever it is given.)
  isOver() {
    return (
      this.options.length === 0 ||
      this.halfmoveClock >= 150 ||
      this.repeats >= 5 ||
      insufficientMaterial(this.placement)
    );
  }

  result() {
    if (this.isCheckmate()) return this.chess.turn() === "w" ? "0-1" : "1-0";
    return this.isOver() ? "1/2-1/2" : "*";
  }

  // A believable result for a game that the encoder stops at its length
  // limit: if one side is at least a minor piece ahead, the other "resigned";
  // otherwise the players "agreed a draw". (The result carries no data.)
  resultIfStopped() {
    const value = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    let balance = 0; // white's material minus black's
    for (const ch of this.placement) {
      const points = value[ch.toLowerCase()] ?? 0;
      balance += ch < "a" ? points : -points; // upper-case letters are white pieces
    }
    return balance >= 3 ? "1-0" : balance <= -3 ? "0-1" : "1/2-1/2";
  }
}

// True if neither side has enough pieces left to ever give checkmate.
// `placement` is the piece part of a FEN, e.g. "8/8/4k3/8/8/2B5/8/4K3".
function insufficientMaterial(placement) {
  const pieces = [];
  let row = 0;
  let col = 0;
  for (const ch of placement) {
    if (ch === "/") {
      row++;
      col = 0;
    } else if (ch >= "1" && ch <= "8") {
      col += Number(ch);
    } else {
      // Upper-case letters are white pieces.
      pieces.push({ type: ch.toLowerCase(), white: ch < "a", dark: (row + col) % 2 === 1 });
      col++;
    }
  }
  const has = (list, types) => list.some((p) => types.includes(p.type));
  const cannotMate = (white) => {
    const own = pieces.filter((p) => p.white === white);
    const theirs = pieces.filter((p) => p.white !== white);
    if (has(own, "prq")) return false;
    if (has(own, "n")) return own.length <= 2 && !has(theirs, "prbn");
    if (has(own, "b")) {
      const bishops = pieces.filter((p) => p.type === "b");
      const sameColour = bishops.every((b) => b.dark) || bishops.every((b) => !b.dark);
      return sameColour && !has(pieces, "pn");
    }
    return true; // a lone king
  };
  return cannotMate(true) && cannotMate(false);
}
