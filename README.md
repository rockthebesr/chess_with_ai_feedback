# Local Chess Coach

A private, local-first chess learning app for one Mac. It supports human vs. Stockfish and two people sharing one computer, with engine-grounded coaching after every move. The board, rules, engine, saved games, review tools, and factual coaching text are local. A small local model—or the signed-in ChatGPT subscription fallback—selects the most useful item from server-verified coaching insights.

Iteration 1 is implemented. There is no network multiplayer, hosting, account system, chess clock, or iteration 2 infrastructure.

## Mac setup

Prerequisites:

- macOS on Apple silicon or Intel
- Node.js 22.5 or newer (`node --version`)
- Homebrew
- The Codex CLI, signed into ChatGPT

Install the local chess engine and project dependencies:

```sh
brew install stockfish
npm install
```

Sign in for subscription-backed coaching:

```sh
codex login
```

Choose the ChatGPT sign-in flow, not API key authentication. The app checks `account/read` and enables natural-language coaching only when Codex reports `type: "chatgpt"`; it deliberately refuses API-key mode so it cannot create separate API charges. The official protocol documents managed ChatGPT authentication, plan reporting, model discovery, rate limits, and streamed turns in the [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

After dependency installation, the one development startup command is:

```sh
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The backend binds only to `127.0.0.1`; it is not exposed to the LAN.

On this Mac, `/opt/homebrew/bin/chess-coach` is linked to `scripts/start-mac.sh`. From any folder, run:

```sh
chess-coach
```

It starts the app, waits until the local page is ready, and opens the default browser. Keep that Terminal window open; press **Ctrl-C** there to stop the app. If the app is already running, the command simply opens it again.

For a production-style local run:

```sh
npm run build
npm start
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Coaching and offline use

At startup, the backend launches `codex app-server` over local stdio, confirms managed ChatGPT authentication, and discovers models available to the account. It prefers the efficient `gpt-5.6-luna` for concise coaching, with `gpt-5.6-sol` as a fallback. Set `CHESS_COACH_MODEL` to another available model ID if you want an explicit override. Credentials remain in Codex-managed storage and are never sent to the browser or stored in the game database. The model cannot author factual coaching prose: it returns a move ID, verified verdict, and one supplied insight ID, while the server renders the corresponding explanation and lesson.

The coaching turn runs with a dedicated empty working directory, read-only sandbox, no approvals, and no network-enabled tools. Stockfish supplies the chess facts; the model explains the supplied packet. Live hints remain hidden in shared-computer games unless both players enable them in game setup.

To run without natural-language coaching:

```sh
CHESS_COACH_DISABLED=1 npm run dev
```

Play remains available when Codex is offline, rate-limited, interrupted, or not signed in. Each move gets deterministic fallback feedback. If Stockfish is absent, bot play and material-only feedback also remain available, but candidate lines and verified positional evaluations are clearly marked unavailable.

## Local data and exports

Games are saved immediately in:

```text
~/Library/Application Support/Local Chess Coach/chess-coach.sqlite
```

Override the directory with `CHESS_COACH_DATA_DIR=/absolute/path`. The database, Codex credentials, and `.env` files are ignored by Git. Every opened game has a bookmarkable `/games/<id>` address, so a refresh returns to the same game. Saved games can be permanently removed one at a time with **Delete**, or all together with **Delete all** after confirmation. Use **Export PGN** in a completed game's review panel to download its valid main line and result. Review-board moves are temporary and never change the saved game.

## Behavior notes

- Normal play never waits for coaching. Guided practice pauses after every accepted move, but **Continue** works even if analysis or coaching failed.
- In bot games, the coaching feed shows only the human player's moves. Bot moves stay out of the feed, while Stockfish still evaluates them in the background.
- Bot replies pause briefly after selecting a move, so the game feels more natural instead of responding instantly.
- “Show engine suggestion lines during the game” lets both players open Stockfish continuations before the game ends. When it is off, those continuations remain hidden until the game is finished.
- Main coaching uses beginner-friendly opening names and practical board-specific advice. Opening plans are shown only for opening families with stored plan guidance; other ECO matches are clearly name-only. Numerical scores and detailed lines stay inside **engine details**.
- Before coaching is shown, the server derives typed facts for material changes, captures, checks, promotions, legal attackers and defenders, loose or rescued pieces, forks, line motifs, development, castling, and central pawn play. The model chooses one verified insight and cannot add prose. Invalid selections receive up to three retries; infrastructure failures fail immediately, and the app uses a verified rules-based fallback if needed.
- Board colors and piece designs can be selected during setup or changed from **Appearance** below the board. In-game appearance choices are remembered on that Mac.
- Takeback and restart create a new branch identity. Late bot, analysis, or coaching events from the old branch are ignored; active Codex turns are interrupted when possible.
- Coaching jobs are ordered within each game, while separate games have independent queues so one slow response cannot block another game.
- Threefold repetition and the fifty-move rule are treated as automatic draws in iteration 1. This is the app's explicit local rules policy; no separate claim UI is required.
- Verdicts are app estimates based on comparable Stockfish searches, not Chess.com or Lichess classifications. Mate scores are never treated as centipawns.
- Opening recognition uses an offline, bundled ECO position book with more than 15,000 named positions. It recognizes transpositions and retains the deepest recognized name when play leaves its named book line.

## Troubleshooting

### Free local AI coach

The app now prefers the free local **Gemma 3 4B** coach through Ollama. It runs on this Mac and does not send coaching prompts to a cloud model. If Ollama is unavailable—or a request cannot produce a valid insight after three retries—the app makes one request-time attempt with the existing ChatGPT coach before using deterministic fallback text. If Ollama is down, later moves keep using ChatGPT; the app rechecks at most every 30 seconds during play and returns to Gemma without a restart.

To set it up on another Mac:

```bash
brew install ollama
brew services start ollama
ollama pull gemma3:4b
```

**“No managed ChatGPT sign-in is active.”** Run `codex login`, choose ChatGPT, then restart the app. `codex app-server` must be available on `PATH`; alternatively set `CODEX_PATH` to the executable.

**“Codex is signed in with an API key.”** Sign out and use ChatGPT login. The app will not silently use API billing.

**Coaching is unavailable or rate-limited.** Keep playing; the move is already saved. Restart after the account limit resets. The home screen shows the current provider state.

**Stockfish is not found.** Run `brew install stockfish`, restart, or set `STOCKFISH_PATH` to an executable UCI-compatible Stockfish binary.

**A spinner appears stuck.** The UI uses explicit queued/streaming/unavailable states. If the backend stopped, restart `npm run dev`; unfinished jobs are recovered as unavailable rather than left pending forever.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

See [VALIDATION.md](./VALIDATION.md) for the observed iteration 1 verification results and live subscription smoke-test timing.
The completed coaching hardening checklist is in [COACHING_IMPROVEMENTS.md](./COACHING_IMPROVEMENTS.md).

## Dependencies and licenses

- `chess.js` (BSD-2-Clause), React (MIT), `ws` (MIT), and Zod (MIT) are installed from npm; exact resolved versions are in `package-lock.json`.
- Stockfish is GPLv3. This project invokes the separately installed Homebrew executable and does not redistribute it. If a future package bundles Stockfish, its corresponding-source and license obligations must be fulfilled.
- The bundled opening position book is derived from the MIT-licensed [eco.json](https://github.com/omuryanikoglu/eco.json) database.
- Codex App Server/WebSocket interfaces can evolve; this app uses stable local stdio transport and validates runtime responses. The documented WebSocket transport is not used.
