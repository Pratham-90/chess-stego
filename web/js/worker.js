// Runs the slow work (key stretching, encoding, decoding) off the main thread
// so the page and the 3D board stay smooth.
import { decode, encode, stats, toPgn, DecodeError } from "./codec.js";
import { decrypt, encrypt, DecryptionError } from "./crypto.js";
import { HumanRanker, UciRanker } from "./rankers.js";

// Report progress to the page, at most once per 1% step. (scrypt alone calls
// back about 10,000 times; sending every one made Safari several times slower.)
function progress(stage) {
  let reported = -1;
  return (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent === reported) return;
    reported = percent;
    postMessage({ type: "progress", stage, fraction });
  };
}

const startRanker = (style) => (style === "natural" ? HumanRanker.start() : new UciRanker());

// Real games are not all the same length. In the natural style each game gets
// its own limit between 40 and 150 plies, short ones more often (average
// about 76, like the human games we measured). Only the encoder needs this.
const naturalLength = () => 40 + Math.floor(110 * Math.random() ** 2);

async function hide({ bytes, password, style }) {
  const encrypted = await encrypt(bytes, password, progress("Stretching the password"));
  const ranker = await startRanker(style);
  try {
    const games = await encode(encrypted, ranker, {
      maxPlies: style === "natural" ? naturalLength : undefined,
      onProgress: progress("Playing the games"),
    });
    return { games, pgn: toPgn(games), stats: stats(games), encryptedSize: encrypted.length };
  } finally {
    ranker.close();
  }
}

// The games do not say which style they were made in (that would give the
// secret away), so try both. The right style with the right password is the
// only combination that passes the encryption's integrity check.
async function reveal({ pgn, password }) {
  let illegal = null;
  for (const style of ["random", "natural"]) {
    const ranker = await startRanker(style);
    try {
      const { bytes: encrypted, games } = await decode(pgn, ranker, {
        onProgress: progress(style === "natural" ? "Replaying the games with the engine" : "Replaying the games"),
      });
      const bytes = await decrypt(encrypted, password, progress("Stretching the password"));
      return { games, bytes, stats: stats(games), style };
    } catch (error) {
      if (!(error instanceof DecodeError || error instanceof DecryptionError)) throw error;
      if (error.illegalMove) illegal ??= error; // not chess at all: worth reporting as such
    } finally {
      ranker.close();
    }
  }
  throw illegal ?? new DecryptionError("Wrong password, or the games were changed.");
}

onmessage = async ({ data }) => {
  try {
    const result = data.type === "hide" ? await hide(data) : await reveal(data);
    postMessage({ type: "done", ...result });
  } catch (error) {
    // Only our own two error types carry messages meant for people.
    const expected = error instanceof DecodeError || error instanceof DecryptionError;
    postMessage({ type: "error", message: expected ? error.message : `Something went wrong: ${error.message}` });
  }
};
