// The page itself: the Hide / Reveal forms on the left, and the game viewer
// (3D board, numbered moves, playback buttons) on the right.
import { Chess } from "../vendor/chess.js";
import { Board3D } from "./board3d.js";

const $ = (id) => document.getElementById(id);

const OVERHEAD = 45; // salt 16 + nonce 12 + tag 16 + the 0x01 marker byte

// The two styles of game. The numbers are measured averages; the size limits
// keep a job to a few minutes at most (chess is a slow way to carry data).
const STYLES = {
  random: { bitsPerMove: 4.55, msPerMove: 0.15, maxBytes: 100 * 1024 },
  natural: { bitsPerMove: 2.35, msPerMove: 14, maxBytes: 4 * 1024 },
};
const chosenStyle = () => document.querySelector('input[name="style"]:checked').value;

// ---------- small helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent, never innerHTML
  return node;
}

function formatBytes(count) {
  if (count < 1024) return `${count} byte${count === 1 ? "" : "s"}`;
  return `${(count / 1024).toFixed(count < 10240 ? 1 : 0)} KB`;
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(button, text) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = label), 1400);
}

// ---------- the background worker ----------

let worker = null;
let job = null; // one job at a time: { resolve, reject, onProgress }

function startWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") job?.onProgress(data);
    else if (data.type === "done") job?.resolve(data);
    else job?.reject(new Error(data.message));
  };
  worker.onerror = (event) => job?.reject(new Error(event.message || "The background worker failed."));
}
startWorker();

function runJob(message, onProgress) {
  return new Promise((resolve, reject) => {
    job = { resolve, reject, onProgress };
    worker.postMessage(message);
  }).finally(() => (job = null));
}

// Stopping a job means throwing the whole worker away and starting a new one.
function cancelJob() {
  if (!job) return;
  worker.terminate();
  job.reject(new Error("Cancelled."));
  startWorker();
}

// Run a job while showing its progress in one of the two status lines.
async function withStatus(kind, message) {
  const status = $(`${kind}-message`);
  const button = $(`${kind}-go`);
  button.disabled = true;
  $(`${kind}-cancel`).hidden = false;
  status.className = "message busy";
  status.textContent = "Starting";
  try {
    const result = await runJob(message, ({ stage, fraction }) => {
      status.textContent = stage;
      status.style.setProperty("--progress", fraction);
    });
    status.className = "message";
    status.textContent = "";
    return result;
  } catch (error) {
    status.className = "message error";
    status.textContent = error.message;
    return null;
  } finally {
    button.disabled = false;
    $(`${kind}-cancel`).hidden = true;
    status.style.removeProperty("--progress");
  }
}

function fail(kind, text) {
  const status = $(`${kind}-message`);
  status.className = "message error";
  status.textContent = text;
}

// ====================================================================
// The game viewer
// ====================================================================

const board = new Board3D($("board"));
const chess = new Chess(); // the position currently on the board

const view = {
  games: [], // from the worker: [{ sans, ucis, digits, radixes, result }]
  game: 0, // which game is shown
  ply: 0, // how many of its moves have been played
  playing: false,
  timer: null,
  hovered: null,
};

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

function piecesOnBoard() {
  return chess.board().flat().filter(Boolean); // [{ square, type, color }]
}

// What the 3D board needs to know to animate a move chess.js just made.
function describeMove(move) {
  const rank = move.from[1];
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    // En passant is the one capture where the taken pawn is not on the target square.
    captured: move.isEnPassant() ? move.to[0] + rank : move.captured ? move.to : null,
    rook: move.isKingsideCastle() ? { from: "h" + rank, to: "f" + rank }
      : move.isQueensideCastle() ? { from: "a" + rank, to: "d" + rank }
      : null,
  };
}

// The candidate moves in the current position, in the order the codec numbers
// them. Random style: every legal move, sorted by UCI string. Natural style:
// the engine's best moves, best first (the worker sent us that list).
function currentOptions() {
  const legal = chess.moves({ verbose: true })
    .map((move) => ({ uci: move.from + move.to + (move.promotion ?? ""), san: move.san }))
    .sort((a, b) => (a.uci < b.uci ? -1 : 1));
  const ranked = view.games[view.game]?.choices[view.ply];
  return ranked ? ranked.map((uci) => legal.find((move) => move.uci === uci)) : legal;
}

// Show game `g` after `p` moves. With `animate`, a single step forward glides.
function show(g, p, animate = false) {
  const game = view.games[g];
  const oneStep = animate && g === view.game && p === view.ply + 1;
  if (oneStep) {
    const move = chess.move(toMove(game.ucis[p - 1]));
    board.animateMove(describeMove(move), moveDuration());
  } else {
    chess.reset();
    if (game) for (let i = 0; i < p; i++) chess.move(toMove(game.ucis[i]));
    board.setPosition(piecesOnBoard());
  }
  view.game = g;
  view.ply = p;

  const last = game && p > 0 ? game.ucis[p - 1] : null;
  board.setLastMove(last?.slice(0, 2), last?.slice(2, 4));
  renderHud();
}

function renderHud() {
  const game = view.games[view.game];
  const options = currentOptions();
  const chosen = game && view.ply < game.ucis.length ? game.digits[view.ply] : -1;
  view.options = options;
  view.chosen = chosen;

  board.setOptions(options.map((option) => option.uci));
  board.setArrow(chosen >= 0 ? options[chosen].uci : null);

  // --- the row of numbered moves ---
  const rail = $("rail");
  rail.replaceChildren(...options.map((option, index) => {
    const chip = el("button", index === chosen ? "chip chosen" : "chip");
    chip.type = "button";
    chip.setAttribute("role", "listitem");
    chip.dataset.uci = option.uci;
    chip.title = `Move ${option.san} (${option.uci}) is number ${index}`;
    chip.append(el("i", "", String(index)), el("b", "", option.san));
    return chip;
  }));
  rail.querySelector(".chosen")?.scrollIntoView({ block: "nearest", inline: "center" });

  // --- the sentence above it ---
  const inspector = $("inspector");
  const count = options.length;
  const natural = Boolean(game?.choices.length);
  if (!game) {
    inspector.replaceChildren(el("span", "plain",
      `The starting position has ${count} legal moves. Number them 0 to ${count - 1}, ` +
      "and playing one of them says a number without writing it down."));
    $("rail-label").textContent = "Point at a move (or tap it) to see it on the board.";
  } else if (chosen >= 0) {
    // e.g. "31 legal moves", with the number emphasised
    const fact = (before, value, after, className = "fact") => {
      const node = el("span", className, before);
      node.append(el("b", "", value), after);
      return node;
    };
    inspector.replaceChildren(
      fact("", String(count), natural ? " candidate moves" : " legal moves"),
      fact("the data says ", `${chosen} \u2192 ${options[chosen].san}`, "", "fact chosen"),
      fact("this move hides ", game.bits[view.ply].toFixed(2), " bits"));
    $("rail-label").textContent = natural
      ? `The chess engine's ${count} best moves here, best first. The data picked number ${chosen}; ` +
        "low numbers get picked more often, the way people play."
      : `All ${count} legal moves here, ordered by the square the piece starts on. The hidden data picked number ${chosen}.`;
  } else {
    const isLast = view.game === view.games.length - 1;
    const why = chess.isCheckmate() ? "Checkmate." : chess.isStalemate() ? "Stalemate."
      : isLast ? "The data ran out here." : "This game was stopped here.";
    inspector.replaceChildren(el("span", "plain",
      `${why} ${isLast ? "That is the whole message." : "The data carries on in the next game."}`));
    $("rail-label").textContent = count ? "Moves that were not needed." : "No legal moves.";
  }

  // --- playback controls ---
  const length = game ? game.ucis.length : 0;
  $("scrub").max = length;
  $("scrub").value = view.ply;
  $("counter").textContent = game
    ? `game ${view.game + 1}/${view.games.length} · move ${view.ply}/${length}`
    : "no games yet";
  const atEnd = !game || (view.game === view.games.length - 1 && view.ply === length);
  for (const id of ["prev-game", "step-back", "play", "step-forward", "next-game", "scrub"]) {
    $(id).disabled = !game;
  }
  // The play button shows one of three icons; style.css picks it from data-state.
  const state = view.playing ? "pause" : atEnd && game ? "replay" : "play";
  $("play").dataset.state = state;
  $("play").setAttribute("aria-label", { pause: "Pause", replay: "Play again", play: "Play" }[state]);
}

// ---------- playback ----------

const stepDelay = () => 1100 / Number($("speed").value);
const moveDuration = () => Math.min(480, stepDelay() * 0.7);

// Returns false when there is nothing left to play.
function stepForward(animate = true) {
  const game = view.games[view.game];
  if (!game) return false;
  if (view.ply < game.ucis.length) show(view.game, view.ply + 1, animate);
  else if (view.game < view.games.length - 1) show(view.game + 1, 0);
  else return false;
  return true;
}

function stepBack() {
  if (view.ply > 0) show(view.game, view.ply - 1);
  else if (view.game > 0) show(view.game - 1, view.games[view.game - 1].ucis.length);
}

function setPlaying(playing) {
  view.playing = playing;
  clearTimeout(view.timer);
  if (playing) tick();
  renderHud();
}

function tick() {
  if (!stepForward()) return setPlaying(false);
  // Pause a little longer on the last position of each game.
  const game = view.games[view.game];
  const pause = view.ply === game.ucis.length ? 3 : 1;
  view.timer = setTimeout(tick, stepDelay() * pause);
}

function loadGames(games, autoplay) {
  setPlaying(false);
  view.games = games;
  show(0, 0);
  if (autoplay) view.timer = setTimeout(() => setPlaying(true), 600);
}

$("play").addEventListener("click", () => {
  const game = view.games[view.game];
  const atEnd = view.game === view.games.length - 1 && view.ply === game.ucis.length;
  if (!view.playing && atEnd) show(0, 0);
  setPlaying(!view.playing);
});
$("step-forward").addEventListener("click", () => { setPlaying(false); stepForward(); });
$("step-back").addEventListener("click", () => { setPlaying(false); stepBack(); });
$("next-game").addEventListener("click", () => {
  setPlaying(false);
  if (view.game < view.games.length - 1) show(view.game + 1, 0);
});
$("prev-game").addEventListener("click", () => {
  setPlaying(false);
  show(view.ply === 0 && view.game > 0 ? view.game - 1 : view.game, 0);
});
$("scrub").addEventListener("input", (event) => {
  setPlaying(false);
  show(view.game, Number(event.target.value));
});
$("speed").addEventListener("change", () => { if (view.playing) setPlaying(true); });

// Hovering (or focusing) a numbered move previews it on the board; leaving
// puts the arrow back on the move the data chose.
function previewMove(chip) {
  const chosen = view.chosen >= 0 ? view.options[view.chosen].uci : null;
  board.setArrow(chip ? chip.dataset.uci : chosen);
}
for (const type of ["pointerover", "focusin"]) {
  $("rail").addEventListener(type, (event) => previewMove(event.target.closest(".chip")));
}
for (const type of ["pointerleave", "focusout"]) {
  $("rail").addEventListener(type, () => previewMove(null));
}

// Arrow keys step through the game, space plays, unless you are typing.
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select, button, dialog") || !view.games.length) return;
  if (event.key === "ArrowRight") { setPlaying(false); stepForward(); }
  else if (event.key === "ArrowLeft") { setPlaying(false); stepBack(); }
  else if (event.key === " ") { event.preventDefault(); $("play").click(); }
});

// ====================================================================
// Hide
// ====================================================================

let hideFile = null; // a chosen File, or null to use the text box
let hiddenPgn = "";

function updateEstimate() {
  const style = STYLES[chosenStyle()];
  const size = hideFile ? hideFile.size : new TextEncoder().encode($("hide-text").value).length;
  const moves = Math.ceil(((size + OVERHEAD) * 8) / style.bitsPerMove);
  const seconds = Math.round((moves * style.msPerMove) / 1000);
  const time = seconds < 5 ? "" : seconds < 90 ? `, about ${seconds} s` : `, about ${Math.round(seconds / 60)} min`;
  $("hide-estimate").textContent = size ? `${formatBytes(size)} \u2248 ${moves.toLocaleString()} moves${time}` : "";
}

function setHideFile(file) {
  hideFile = file;
  $("hide-file").hidden = !file;
  $("hide-file-name").textContent = file ? file.name : "";
  $("hide-text").disabled = Boolean(file);
  $("hide-text").placeholder = file ? "Using the file below" : "Type something only one person should read";
  updateEstimate();
}

$("hide-text").addEventListener("input", updateEstimate);
for (const radio of document.querySelectorAll('input[name="style"]')) {
  radio.addEventListener("change", updateEstimate);
}
$("hide-pick").addEventListener("click", () => $("hide-input").click());
$("hide-input").addEventListener("change", (event) => {
  setHideFile(event.target.files[0] ?? null);
  event.target.value = ""; // so choosing the same file again still fires "change"
});
$("hide-file-clear").addEventListener("click", () => setHideFile(null));

$("hide-go").addEventListener("click", async () => {
  const password = $("hide-password").value;
  const bytes = hideFile
    ? new Uint8Array(await hideFile.arrayBuffer())
    : new TextEncoder().encode($("hide-text").value);
  if (!bytes.length) return fail("hide", "Type a message or choose a file first.");
  const style = chosenStyle();
  if (bytes.length > STYLES[style].maxBytes) {
    return fail("hide", `That is ${formatBytes(bytes.length)}. The limit for ${style} moves is ` +
      `${formatBytes(STYLES[style].maxBytes)}, because chess is a slow way to carry data.`);
  }
  if (!password) return fail("hide", "Choose a password. The receiver will need the same one.");

  const result = await withStatus("hide", { type: "hide", bytes, password, style });
  if (!result) return;
  hiddenPgn = result.pgn;

  const cell = (value, label) => {
    const item = el("li");
    item.append(el("b", "", value), el("span", "", label));
    return item;
  };
  $("hide-pipeline").replaceChildren(
    cell(formatBytes(bytes.length), "your secret"),
    cell(formatBytes(result.encryptedSize), "after locking"),
    cell(result.stats.moves.toLocaleString(), `moves in ${result.stats.games} game${result.stats.games === 1 ? "" : "s"}`),
    cell(result.stats.bitsPerMove.toFixed(2), "bits per move"));
  // Show only the start of long files; the download has everything.
  $("hide-pgn").textContent = hiddenPgn.length > 4000 ? hiddenPgn.slice(0, 4000) + "\n…" : hiddenPgn;
  $("hide-note").textContent = "Send the games however you like, and share the password some other way. " +
    (style === "natural"
      ? "These games look much more like real chess, but a careful statistical test may still tell them apart."
      : "These games look like random play, so a chess player would find them odd.") +
    " Either way, it is the password that keeps the message safe.";
  $("hide-result").hidden = false;
  loadGames(result.games, true);
});

$("hide-download").addEventListener("click", () => download("games.pgn", hiddenPgn, "application/x-chess-pgn"));
$("hide-copy").addEventListener("click", (event) => copyText(event.target, hiddenPgn));
$("hide-try").addEventListener("click", () => {
  $("reveal-text").value = hiddenPgn;
  $("reveal-password").value = "";
  $("reveal-result").hidden = true;
  selectTab("reveal");
  $("reveal-password").focus();
});

// ====================================================================
// Reveal
// ====================================================================

let revealed = null; // { bytes, text, name, type }

// Guess what kind of file the recovered bytes are from their first few bytes.
function identify(bytes) {
  const starts = (...values) => values.every((value, i) => bytes[i] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { label: "PNG image", name: "recovered.png", type: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { label: "JPEG image", name: "recovered.jpg", type: "image/jpeg" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { label: "GIF image", name: "recovered.gif", type: "image/gif" };
  if (starts(0x25, 0x50, 0x44, 0x46)) return { label: "PDF document", name: "recovered.pdf", type: "application/pdf" };
  if (starts(0x50, 0x4b, 0x03, 0x04)) return { label: "ZIP archive (or Office file)", name: "recovered.zip", type: "application/zip" };
  try {
    // Valid UTF-8 with no control characters is treated as a text message.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      return { label: "Message", name: "recovered.txt", type: "text/plain", text };
    }
  } catch { /* not text */ }
  return { label: "File of an unknown kind", name: "recovered.bin", type: "application/octet-stream" };
}

$("reveal-pick").addEventListener("click", () => $("reveal-input").click());
$("reveal-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (file) $("reveal-text").value = await file.text();
  event.target.value = "";
});

$("reveal-go").addEventListener("click", async () => {
  const pgn = $("reveal-text").value;
  const password = $("reveal-password").value;
  $("reveal-result").hidden = true;
  if (!pgn.trim()) return fail("reveal", "Paste the chess games first.");
  if (!password) return fail("reveal", "Enter the password the sender used.");

  const result = await withStatus("reveal", { type: "reveal", pgn, password });
  if (!result) return;
  revealed = { bytes: result.bytes, ...identify(result.bytes) };

  $("reveal-kind").textContent = `${revealed.label} · ${formatBytes(result.bytes.length)}`;
  $("reveal-secret").hidden = revealed.text === undefined;
  $("reveal-secret").textContent = revealed.text ?? "";
  $("reveal-copy").hidden = revealed.text === undefined;
  const image = $("reveal-image");
  if (image.src) URL.revokeObjectURL(image.src);
  image.hidden = !revealed.type.startsWith("image/");
  if (!image.hidden) image.src = URL.createObjectURL(new Blob([revealed.bytes], { type: revealed.type }));
  $("reveal-download").textContent = `Download ${revealed.name}`;
  $("reveal-result").hidden = false;
  loadGames(result.games, false);
});

$("reveal-download").addEventListener("click", () => download(revealed.name, revealed.bytes, revealed.type));
$("reveal-copy").addEventListener("click", (event) => copyText(event.target, revealed.text));

// ====================================================================
// Page furniture: tabs, show-password buttons, drag and drop, dialog
// ====================================================================

function selectTab(name) {
  for (const tab of ["hide", "reveal"]) {
    const selected = tab === name;
    $(`tab-${tab}`).setAttribute("aria-selected", selected);
    $(`tab-${tab}`).tabIndex = selected ? 0 : -1;
    $(`pane-${tab}`).hidden = !selected;
  }
}
$("tab-hide").addEventListener("click", () => selectTab("hide"));
$("tab-reveal").addEventListener("click", () => selectTab("reveal"));
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const next = $("tab-hide").getAttribute("aria-selected") === "true" ? "reveal" : "hide";
  selectTab(next);
  $(`tab-${next}`).focus();
});

for (const button of document.querySelectorAll("[data-toggle]")) {
  button.addEventListener("click", () => {
    const input = $(button.dataset.toggle);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", show);
  });
}

// Dropping a file anywhere on the page: a .pgn goes to Reveal, anything else to Hide.
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  if (file.name.toLowerCase().endsWith(".pgn")) {
    $("reveal-text").value = await file.text();
    selectTab("reveal");
  } else {
    setHideFile(file);
    selectTab("hide");
  }
});

$("hide-cancel").addEventListener("click", cancelJob);
$("reveal-cancel").addEventListener("click", cancelJob);

$("how-open").addEventListener("click", () => $("how").showModal());
$("how-close").addEventListener("click", () => $("how").close());
$("how").addEventListener("click", (event) => {
  if (event.target === $("how")) $("how").close(); // a click on the dimmed backdrop
});

// First paint: the starting position, with its 20 numbered moves.
show(0, 0);
updateEstimate();
