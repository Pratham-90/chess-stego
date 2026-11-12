// Quick checks of the JavaScript port on its own (no Python needed):
//     node test/selftest.mjs
import assert from "node:assert/strict";
import { decode, encode, parsePgn, putWeightedDigit, stats, takeWeightedDigit, toPgn, DecodeError } from "../js/codec.js";
import { decrypt, encrypt, DecryptionError } from "../js/crypto.js";
import { HumanRanker, UciRanker } from "../js/rankers.js";

const random = (size) => crypto.getRandomValues(new Uint8Array(size));
const same = (a, b) => assert.deepEqual([...a], [...b]);
const uci = new UciRanker();

// 1. codec round trips, including the awkward cases
for (const data of [new Uint8Array(0), new Uint8Array([0]), new Uint8Array([0, 0, 5]), random(1024), random(20000)]) {
  const games = await encode(data, uci);
  same((await decode(toPgn(games), uci)).bytes, data);
}
console.log("ok  codec round trips");

// 2. capacity is the same as the Python version (about 4.5 bits per move)
const s = stats(await encode(random(4096), uci));
assert.ok(s.bitsPerMove > 4.3 && s.bitsPerMove < 4.8, `bits per move ${s.bitsPerMove}`);
console.log(`ok  ${s.bitsPerMove.toFixed(2)} bits per move, ${s.games} games for 4 KB`);

// 3. full pipeline with a password
const secret = new TextEncoder().encode("meet me at the usual place, 9pm ♞");
const pgn = toPgn(await encode(await encrypt(secret, "correct horse"), uci));
same(await decrypt((await decode(pgn, uci)).bytes, "correct horse"), secret);
await assert.rejects(async () => decrypt((await decode(pgn, uci)).bytes, "wrong horse"), DecryptionError);
console.log("ok  encrypt -> games -> decrypt, wrong password rejected");

// 4. changing one move is detected: either the rest of the game stops being
//    legal chess, or the decrypted data fails its integrity check
const moves = parsePgn(pgn)[0];
const swapped = pgn.replace(` ${moves[0]} `, moves[0] === "e4" ? " d4 " : " e4 ");
assert.notEqual(swapped, pgn);
await assert.rejects(
  async () => decrypt((await decode(swapped, uci)).bytes, "correct horse"),
  (error) => error instanceof DecodeError || error instanceof DecryptionError);
await assert.rejects(decode("1. e4 e5 2. Ke3 *", uci), DecodeError); // illegal move
await assert.rejects(decode("hello", uci), DecodeError);
console.log("ok  tampering and illegal moves are rejected");

// 5. weighted digits: taking a digit and putting it back gives the same number
for (const weights of [[11, 5, 4, 2, 2, 1, 1, 1], [5, 2, 1], [11], [1, 1, 1]]) {
  for (const n of [0n, 1n, 7n, 26n, 27n, 12345678901234567890n]) {
    const [rest, digit] = takeWeightedDigit(n, weights);
    assert.equal(putWeightedDigit(rest, digit, weights), n);
  }
}
console.log("ok  weighted digits are reversible");

// 6. "natural moves": Stockfish's top 8, better moves more often
if (process.argv.includes("--no-engine")) {
  console.log("skipped engine checks");
} else {
  const human = await HumanRanker.start();
  const data = random(300);
  const lengths = () => 40 + Math.floor(Math.random() * 60); // varied game lengths
  let started = performance.now();
  const games = await encode(data, human, { maxPlies: lengths });
  const encodeMs = performance.now() - started;
  const natural = toPgn(games);
  human.close();

  // Decode with a brand-new engine, as the receiver would.
  const receiver = await HumanRanker.start();
  same((await decode(natural, receiver)).bytes, data);
  // A game in the other style is rejected, not misread.
  await assert.rejects(decode(pgn, receiver), DecodeError);
  receiver.close();

  const n = stats(games);
  assert.ok(n.bitsPerMove > 2.0 && n.bitsPerMove < 2.7, `bits per move ${n.bitsPerMove}`);
  const firstChoice = games.flatMap((g) => g.digits).filter((digit) => digit === 0).length / n.moves;
  assert.ok(firstChoice > 0.3 && firstChoice < 0.55, `engine's best move played ${firstChoice}`);
  console.log(`ok  natural moves round trip: ${n.bitsPerMove.toFixed(2)} bits per move, ` +
    `${(encodeMs / n.moves).toFixed(1)} ms per move, best move played ${(firstChoice * 100).toFixed(0)}% of the time`);
}
