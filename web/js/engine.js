// Talks to the Stockfish chess engine.
//
// Stockfish runs as WebAssembly in a worker of its own. We talk to it in UCI,
// the plain-text protocol every chess engine speaks ("position ...", "go ...").
//
// Encoder and decoder must get the *identical* answer for the same position,
// so every search is made reproducible: a single thread (this build has no
// others), a fixed hash size, a fixed number of positions to search (never a
// time limit, which depends on how busy the computer is), and "ucinewgame"
// before each search to wipe what the engine remembers.
const ENGINE_FILE = "../vendor/stockfish/stockfish-19-lite-single.js";
const NODES = 2000; // positions searched per move
let loadInNode = null;

export class Engine {
  // `send(line)` passes one line of text to the engine.
  constructor(send, stop) {
    this.send = send;
    this.stop = stop;
    this.best = []; // best[i] = first move of the engine's (i+1)-th best line
    this.waiting = null; // { until, resolve }: resolve when a line starts with `until`
    this.multiPv = 1;
  }

  static async start() {
    let engine;
    if (typeof Worker !== "undefined") {
      // In the browser: the engine file is a ready-made worker script.
      const worker = new Worker(new URL(ENGINE_FILE, import.meta.url));
      engine = new Engine((line) => worker.postMessage(line), () => worker.terminate());
      worker.onmessage = (event) => engine.#receive(event.data);
    } else {
      // In Node.js (the tests): load the same file directly.
      const { createRequire } = await import("node:module");
      // Keep the loader function: the engine file replaces its own export the
      // first time it runs, so loading it a second time would not work.
      loadInNode ??= createRequire(import.meta.url)(ENGINE_FILE);
      const raw = loadInNode();
      const keepAlive = setInterval(() => {}, 1000); // Node would exit mid-search otherwise
      // setTimeout: never call into the engine from inside its own output callback.
      engine = new Engine((line) => setTimeout(() => raw.processCommand(line)), () => {
        clearInterval(keepAlive);
        raw.terminate();
      });
      raw.listener = (line) => engine.#receive(line);
    }
    await engine.#ask("uci", "uciok");
    engine.send("setoption name Hash value 16");
    await engine.#ask("isready", "readyok");
    return engine;
  }

  #receive(line) {
    if (typeof line !== "string") return;
    // "info depth 4 ... multipv 2 score cp 25 ... pv e2e3 e7e6": the engine's
    // 2nd-best line so far starts with e2e3. Later lines replace earlier ones.
    const info = /^info .*\bmultipv (\d+) .*\bpv (\S+)/.exec(line);
    if (info) this.best[Number(info[1]) - 1] = info[2];
    if (this.waiting && line.startsWith(this.waiting.until)) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve();
    }
  }

  // Send a command and wait for the reply line that ends it.
  #ask(command, until) {
    return new Promise((resolve) => {
      this.waiting = { until, resolve };
      this.send(command);
    });
  }

  // The engine's `count` best moves, best first, in the position reached by
  // playing `moves` (UCI strings) from the starting position.
  async topMoves(moves, count) {
    if (count !== this.multiPv) {
      this.send(`setoption name MultiPV value ${count}`);
      this.multiPv = count;
    }
    this.best = [];
    this.send("ucinewgame");
    this.send(`position startpos${moves.length ? " moves " + moves.join(" ") : ""}`);
    await this.#ask(`go nodes ${NODES}`, "bestmove");
    return this.best.filter(Boolean);
  }
}
