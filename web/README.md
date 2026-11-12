# Chess Stego: the website

The same tool as the command line, running entirely in the browser. Open the
page, type a message (or pick a file), choose a password, and get chess games
to send to someone. They open the same page, paste the games, type the
password, and get the message back.

Nothing is uploaded: encryption and encoding run in the visitor's own tab.
The page's security policy only lets it fetch its own files.

## Run it on your computer

Any static file server works. From the project root:

```bash
python -m http.server 8123 --directory web
```

Then open <http://localhost:8123>. (Opening `index.html` directly from disk does
not work: browsers block scripts and workers on `file://` pages.)

## The two styles of game

| Style | What it does | Capacity | Speed | Works with the CLI? |
|---|---|---|---|---|
| Random moves | Any legal move, like the CLI's default | about 4.5 bits per move | 50 KB in about 12 s | Yes, both directions |
| Natural moves | Only Stockfish's 8 best moves, better ones more often, varied game lengths | about 2.4 bits per move | 10 to 15 ms per move | No (see below) |

When revealing, the page tries both styles by itself, so the receiver only
needs the password.

**Why natural-style games are website-only.** Both sides must rank moves
identically, so they need the identical engine. The website uses the small
(1.8 MB) Stockfish 19 build, which has a different neural network from the
desktop Stockfish the CLI uses. The full-size WebAssembly build *does* match
the desktop engine (identical top-4 lists on 60 of 60 test positions), but it
is a 99 MB download, so the site does not use it.

Size limits: 100 KB for random moves, 4 KB for natural moves. Larger inputs
would work but take minutes.

## Files

```
index.html, style.css   the page
js/app.js               forms, playback controls, the numbered-moves strip
js/board3d.js           the 3D board and pieces (three.js)
js/worker.js            runs the slow work off the main thread
js/crypto.js            scrypt + AES-256-GCM   (same format as crypto.py)
js/codec.js             bytes <-> number <-> games   (port of codec.py)
js/rankers.js           which moves are candidates   (port of rankers.py)
js/rules.js             legal moves and game-over rules (wraps chess.js)
js/engine.js            talks to Stockfish over the UCI text protocol
vendor/                 third-party libraries, copied in (see below)
test/                   self-test and a tiny CLI used by the Python tests
```

There is no build step for the site itself: the files in this folder are what
the browser loads.

## Tests

```bash
node web/test/selftest.mjs            # JavaScript on its own (about 40 s, uses the engine)
python -m pytest tests/test_web.py    # JavaScript against the Python version
```

`tests/test_web.py` checks that the same bytes give move-for-move identical
games in both languages, that each side decodes the other's files, and that
the natural style decodes in a separate process.

## Putting it online

The folder is a plain static site, so any static host works.

**GitHub Pages** (free): push this repository to GitHub, then in the
repository's *Settings -> Pages* set *Source* to **GitHub Actions**. The
workflow in `.github/workflows/pages.yml` publishes the `web/` folder on every
push to `main`.

**Netlify, Cloudflare Pages, Vercel:** set the publish directory to `web` and
leave the build command empty.

## Third-party code in `vendor/`

Copied in so the page never contacts another server. To rebuild them:
`npm install && npm run vendor` (in this folder).

| File | Library | Licence |
|---|---|---|
| `chess.js` | chess.js 1.4.0 (chess rules) | BSD-2-Clause |
| `scrypt.js` | @noble/hashes 2.4.0 (scrypt) | MIT |
| `three.js` | three.js 0.187.0 (3D graphics) | MIT |
| `fonts/` | Instrument Serif, JetBrains Mono | SIL Open Font License |
| `stockfish/` | Stockfish.js 19.0.1 (chess engine) | **GPL-3.0** |

Stockfish is GPL-3 software. Its licence text is in `vendor/stockfish/Copying.txt`
and its source code is at <https://github.com/nmrugg/stockfish.js> (tag
`v19.0.1`). The site runs it as a separate program in its own worker and only
exchanges text with it. If you publish this site, keep the licence file and
this pointer to the source.
