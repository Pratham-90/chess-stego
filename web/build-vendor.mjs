// Bundles each third-party library into ONE file in vendor/, so the site needs
// no build step and makes no requests to other servers.
//     npm install && npm run vendor
import { copyFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

const libs = {
  "chess.js": "export { Chess } from 'chess.js';",
  "scrypt.js": "export { scryptAsync } from '@noble/hashes/scrypt.js';",
  "three.js": `export * from 'three';
    export { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    export { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
    export { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';`,
};

for (const [file, source] of Object.entries(libs)) {
  await build({
    stdin: { contents: source, resolveDir: "." },
    bundle: true,
    format: "esm",
    minify: true,
    legalComments: "inline", // keep the libraries' licence notices
    outfile: `vendor/${file}`,
  });
  console.log("built vendor/" + file);
}

// Fonts (open-source, SIL Open Font License): copied so the page never has to
// ask a font server for them.
const fonts = [
  "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
  "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
  "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
];
mkdirSync("vendor/fonts", { recursive: true });
for (const font of fonts) {
  copyFileSync(`node_modules/${font}`, `vendor/fonts/${font.split("/").pop()}`);
}
console.log("copied fonts");

// Stockfish compiled to WebAssembly (the small single-threaded build, 1.8 MB).
// It is GPL-3 software, so its licence text travels with it.
mkdirSync("vendor/stockfish", { recursive: true });
for (const file of ["bin/stockfish-19-lite-single.js", "bin/stockfish-19-lite-single.wasm", "Copying.txt"]) {
  copyFileSync(`node_modules/stockfish/${file}`, `vendor/stockfish/${file.split("/").pop()}`);
}
console.log("copied stockfish");
