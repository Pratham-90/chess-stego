// A "ranker" decides which moves are candidates in a position, and in what
// order. The codec then hides a number in the choice among them. Encoder and
// decoder must use the same ranker, because they must build the same list.
import { Engine } from "./engine.js";

// "Random moves": every legal move, sorted by UCI string. Fast and roomy
// (about 4.5 bits per move), but the games look like nonsense.
// This is the Python version's default ranker, so files are interchangeable.
export class UciRanker {
  listsAllMoves = true; // the page can rebuild the list itself
  typicalBits = 4.55;

  async options(game) {
    return game.options;
  }

  weights() {
    return null; // null = every option equally likely (plain mixed radix)
  }

  close() {}
}

// How often real players pick the engine's 1st, 2nd, ... 8th choice, as small
// whole numbers (measured on Lichess games, see analysis/human_ranks.md).
// The best move is chosen 11 times as often as the 8th-best.
const HUMAN_WEIGHTS = [11, 5, 4, 2, 2, 1, 1, 1];

// "Natural moves": only Stockfish's 8 best moves, and the better ones more
// often. The games look much more like real chess, for about half the capacity.
export class HumanRanker {
  listsAllMoves = false;
  typicalBits = 2.35;

  constructor(engine) {
    this.engine = engine;
  }

  static async start() {
    return new HumanRanker(await Engine.start());
  }

  async options(game) {
    const legal = game.options;
    if (legal.length === 1) return legal; // forced move: nothing to rank
    const count = Math.min(HUMAN_WEIGHTS.length, legal.length);
    const ranked = [];
    for (const uci of await this.engine.topMoves(game.ucis, count)) {
      const option = legal.find((candidate) => candidate.uci === uci);
      if (option && !ranked.includes(option)) ranked.push(option);
    }
    // Safety net: if the engine ever reports fewer moves than expected, fill
    // up in a fixed order so both sides still get the same number of options.
    for (const option of legal) {
      if (ranked.length >= count) break;
      if (!ranked.includes(option)) ranked.push(option);
    }
    return ranked;
  }

  weights(count) {
    return HUMAN_WEIGHTS.slice(0, count);
  }

  close() {
    this.engine.stop();
  }
}
