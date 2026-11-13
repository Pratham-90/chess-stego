# Progress

## Finished
- **Setup** — git repo, `.venv`, dependencies installed.
- **Stage 1** — `crypto.py`, `codec.py`, `rankers.py` (UciRanker), `cli.py`, tests, CLI verified on a real file, README quick start. Committed.
- **Stage 2** — Stockfish 19 in `tools/`, `EngineTopKRanker`, CLI flags, cross-process determinism test, `analysis/capacity.md`. Committed.
- **Stage 3** — datasets (300 games per set), features, plots, detectors, `analysis/RESULTS.md`. Committed.
- **Optional stretch** — human rank frequencies (`analysis/human_ranks.md`), weighted digits in the codec, `HumanLikeRanker`, `--ranker human`, human-like game lengths in the dataset, detector re-run (94% -> 77%). Committed.
- **Final report** — `EXPLANATION.md`. Committed.

- **Website** — `web/`: JavaScript port (crypto, codec, rankers), 3D board that shows which numbered move the data picked, "random" and "natural" (Stockfish in WebAssembly) styles, cross-tests against Python in `tests/test_web.py`, GitHub Pages workflow. Committed.

## In progress
- Nothing. The site is live at https://pratham-90.github.io/chess-stego/ (repository: https://github.com/Pratham-90/chess-stego). Checked on the live site in Chromium, Firefox and WebKit (Safari's engine) at desktop and phone sizes. Still untried: Safari itself on a Mac or iPhone, and any physical phone.

## Possible next steps
- See "Ideas for next steps" in `EXPLANATION.md`.
