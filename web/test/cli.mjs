// A tiny command-line front for the JavaScript port, used by tests/test_web.py
// to check that it agrees with the Python version.
//     node web/test/cli.mjs <command> <input> <output>
// Commands: encode, decode (with encryption; password from CHESS_STEGO_PASSWORD),
//           encode-raw, decode-raw (no encryption),
//           encode-natural, decode-natural (no encryption, engine-guided style)
import { readFileSync, writeFileSync } from "node:fs";
import { decode, encode, toPgn } from "../js/codec.js";
import { decrypt, encrypt } from "../js/crypto.js";
import { HumanRanker, UciRanker } from "../js/rankers.js";

const [command, input, output] = process.argv.slice(2);
const password = process.env.CHESS_STEGO_PASSWORD ?? "";
const ranker = command.endsWith("-natural") ? await HumanRanker.start() : new UciRanker();

if (command.startsWith("encode")) {
  let bytes = new Uint8Array(readFileSync(input));
  if (command === "encode") bytes = await encrypt(bytes, password);
  writeFileSync(output, toPgn(await encode(bytes, ranker)));
} else if (command.startsWith("decode")) {
  let { bytes } = await decode(readFileSync(input, "utf8"), ranker);
  if (command === "decode") bytes = await decrypt(bytes, password);
  writeFileSync(output, bytes);
} else {
  console.error("unknown command");
  process.exitCode = 2;
}
ranker.close();
