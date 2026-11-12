// bytes <-> one big integer <-> chess games.
//
// This is a JavaScript port of chess_stego/codec.py.
// The integer is written in a "mixed radix" number system: the base of each
// digit is the number of candidate moves in that position, and the digit says
// which of those moves gets played. Which moves are candidates is decided by
// a "ranker" (see rankers.js).
import { Game } from "./rules.js";

export const MAX_PLIES = 200; // a ply is one move by one side

export class DecodeError extends Error {}

// ---------- bytes <-> integer ----------

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function bytesToInt(bytes) {
  // The leading 01 byte keeps leading zero bytes from being lost: without it,
  // the bytes 00 05 would become the same integer as 05.
  let hex = "01";
  for (const byte of bytes) hex += HEX[byte];
  return BigInt("0x" + hex);
}

export function intToBytes(n) {
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const raw = new Uint8Array(hex.length / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  if (raw[0] !== 1) throw new DecodeError("These games do not contain a hidden message.");
  return raw.subarray(1);
}

// ---------- weighted digits ----------
//
// Plain mixed radix makes every candidate move equally likely. To make some
// moves more likely than others, give each option a weight, e.g. [5, 2, 1]:
// picture 5 + 2 + 1 = 8 numbered slots, where the last option owns slot 0, the
// middle one slots 1-2 and the first one slots 3-7. `n % 8` lands in one slot
// and so picks an option; options that own more slots get picked more often.
// Likely options use up less of n (they carry less information). This is the
// idea behind arithmetic coding. Same maths as codec.py.

const sum = (list) => list.reduce((a, b) => a + b, 0);

// Remove one weighted digit from n. Returns [what is left of n, digit].
export function takeWeightedDigit(n, weights) {
  const total = BigInt(sum(weights));
  const slot = Number(n % total);
  const rest = n / total;
  let start = 0;
  for (let digit = weights.length - 1; digit >= 0; digit--) { // the last option owns slot 0
    if (slot < start + weights[digit]) {
      // Keep the position inside the option's slots: that is leftover
      // information which must not be thrown away.
      return [rest * BigInt(weights[digit]) + BigInt(slot - start), digit];
    }
    start += weights[digit];
  }
  throw new Error("unreachable: slot is always below the total weight");
}

// Exact inverse of takeWeightedDigit.
export function putWeightedDigit(n, digit, weights) {
  const start = BigInt(sum(weights.slice(digit + 1)));
  const weight = BigInt(weights[digit]);
  return (n / weight) * BigInt(sum(weights)) + start + (n % weight);
}

// ---------- integer -> games ----------

// Returns a list of games. Each game is
//   { sans, ucis, digits, radixes, bits, choices, result }
// For move i: radixes[i] candidate moves, the data picked number digits[i],
// which hid bits[i] bits. choices[i] lists the candidates when the ranker
// picked a subset (otherwise the list is simply all legal moves).
//
// `maxPlies` is a number, or a function returning the length limit for the
// next game. The decoder never needs it: it replays whatever it is given.
export async function encode(bytes, ranker, { maxPlies = MAX_PLIES, onProgress } = {}) {
  const nextLimit = typeof maxPlies === "function" ? maxPlies : () => maxPlies;
  let n = bytesToInt(bytes);
  const expectedMoves = (bytes.length * 8 + 8) / ranker.typicalBits; // rough, for the progress bar
  const games = [];
  let game, record, limit;
  let moves = 0;

  const startGame = () => {
    game = new Game();
    limit = nextLimit();
    record = { sans: game.sans, ucis: game.ucis, digits: [], radixes: [], bits: [], choices: [], result: "*" };
  };
  startGame();

  while (n > 0n) {
    const options = await ranker.options(game);
    const weights = ranker.weights(options.length);
    let digit;
    if (weights === null) {
      // Peel off the lowest digit of n in base options.length.
      const base = BigInt(options.length);
      digit = Number(n % base);
      n /= base;
      record.bits.push(Math.log2(options.length));
    } else {
      [n, digit] = takeWeightedDigit(n, weights);
      record.bits.push(Math.log2(sum(weights) / weights[digit]));
    }
    record.digits.push(digit);
    record.radixes.push(options.length);
    if (!ranker.listsAllMoves) record.choices.push(options.map((option) => option.uci));
    game.play(options[digit]);
    moves++;

    if (game.isOver() || game.plies >= limit) {
      record.finished = game.isOver();
      record.result = record.finished ? game.result() : game.resultIfStopped();
      games.push(record);
      startGame();
    }
    if (onProgress && moves % 50 === 0) onProgress(Math.min(moves / expectedMoves, 0.99));
  }
  if (game.plies > 0) games.push(record);
  // The very last game simply stops (result "*"), unless it really ended.
  const last = games[games.length - 1];
  if (last && !last.finished) last.result = "*";
  return games;
}

// ---------- games -> integer ----------

export async function decode(pgnText, ranker, { onProgress } = {}) {
  const parsed = parsePgn(pgnText);
  const totalMoves = parsed.reduce((count, sans) => count + sans.length, 0);
  if (totalMoves === 0) {
    const error = new DecodeError("No chess games found in this text.");
    error.illegalMove = true; // "not chess at all", same handling as an illegal move
    throw error;
  }
  const games = [];
  const steps = []; // [digit, weights or radix] for every move, in order
  for (const [index, sans] of parsed.entries()) {
    const game = new Game();
    const record = { sans: game.sans, ucis: game.ucis, digits: [], radixes: [], bits: [], choices: [], result: "*" };
    for (const san of sans) {
      const played = game.optionFromSan(san);
      if (!played) {
        const error = new DecodeError(
          `Game ${index + 1} has an illegal move (${san}). The games were changed, or this tool did not make them.`);
        error.illegalMove = true;
        throw error;
      }
      const options = await ranker.options(game);
      const digit = options.indexOf(played);
      if (digit < 0) {
        throw new DecodeError(`Game ${index + 1}: ${san} is not a move this style of game would play.`);
      }
      const weights = ranker.weights(options.length);
      steps.push([digit, weights ?? options.length]);
      record.digits.push(digit);
      record.radixes.push(options.length);
      record.bits.push(weights ? Math.log2(sum(weights) / weights[digit]) : Math.log2(options.length));
      if (!ranker.listsAllMoves) record.choices.push(options.map((option) => option.uci));
      game.play(played);
      if (onProgress && steps.length % 50 === 0) onProgress((steps.length / totalMoves) * 0.9);
    }
    record.result = game.result();
    games.push(record);
  }

  // The first move holds the lowest digit, so rebuild from the last move back.
  let n = 0n;
  for (let i = steps.length - 1; i >= 0; i--) {
    const [digit, base] = steps[i];
    n = typeof base === "number" ? n * BigInt(base) + BigInt(digit) : putWeightedDigit(n, digit, base);
  }
  return { bytes: intToBytes(n), games };
}

// ---------- PGN text ----------

const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

// Split PGN text into games; each game becomes a list of moves ("e4", "Nf3", ...).
export function parsePgn(text) {
  const games = [];
  let movetext = "";
  const flush = () => {
    let moves = [];
    const tokens = movetext
      .replace(/\{[^}]*\}/g, " ") // {comments}
      .replace(/;.*$/gm, " ") // ; comments to end of line
      .replace(/\$\d+/g, " ") // $1 style annotations
      .split(/\s+/);
    for (let token of tokens) {
      if (RESULTS.has(token)) {
        if (moves.length) games.push(moves);
        moves = [];
        continue;
      }
      token = token.replace(/^\d+\.+/, ""); // move numbers: "12." or "12..."
      if (token) moves.push(token);
    }
    if (moves.length) games.push(moves);
    movetext = "";
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("[")) flush(); // a header line starts a new game
    else movetext += line + "\n";
  }
  flush();
  return games;
}

// Made-up player names. Headers are decoration only: they carry no data and
// the decoder ignores them, so ordinary randomness is fine here.
const PLAYERS = [
  "knightrider42", "quiet_bishop", "e4enjoyer", "rook_and_roll", "pawnstorm",
  "silentgambit", "blitzowl", "endgame_eddie", "castlekeeper", "tal_fan_88",
  "the_fianchetto", "zugzwang_zoe", "oldmanchess", "lucky_fork", "darksquares",
];

export function toPgn(games) {
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join(".");
  return games.map((game) => {
    const white = PLAYERS[Math.floor(Math.random() * PLAYERS.length)];
    let black = white;
    while (black === white) black = PLAYERS[Math.floor(Math.random() * PLAYERS.length)];
    const headers = [
      ["Event", "Casual game"], ["Site", "Online"], ["Date", date], ["Round", "-"],
      ["White", white], ["Black", black], ["Result", game.result],
    ].map(([name, value]) => `[${name} "${value}"]`);

    // Move text: "1. e4 e5 2. Nf3 ..." wrapped at 80 columns like other PGN writers.
    const words = [];
    game.sans.forEach((san, i) => {
      if (i % 2 === 0) words.push(`${i / 2 + 1}.`);
      words.push(san);
    });
    words.push(game.result);
    const lines = [];
    let line = "";
    for (const word of words) {
      if (line && line.length + 1 + word.length > 80) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
    return headers.join("\n") + "\n\n" + lines.join("\n");
  }).join("\n\n") + "\n";
}

// ---------- summary numbers ----------

export function stats(games) {
  let moves = 0;
  let bits = 0;
  for (const game of games) {
    moves += game.bits.length;
    for (const value of game.bits) bits += value;
  }
  return { games: games.length, moves, bitsPerMove: moves ? bits / moves : 0 };
}
