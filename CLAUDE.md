# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Local Chess Coach: a private, single-Mac chess app (human vs. Stockfish, or two people on one computer) with coaching after every move. Network multiplayer, hosting, accounts, and clocks are out of scope ("iteration 2"); don't add them unless asked. Requires Node >= 22.5 (uses the built-in `node:sqlite`).

## Commands

```sh
npm run dev         # backend (tsx watch, :4173) + Vite (:5173); open http://127.0.0.1:5173
npm test            # vitest run
npx vitest run tests/verdict.test.ts      # one file
npx vitest run -t "test name substring"   # one test
npm run typecheck   # strict tsc for frontend and server; does not include tests/
npm run build       # tsc to dist-server/ + vite build to dist/
npm start           # production-style on :4173; runs server/index.ts via tsx and serves dist/
```

There is no linter or formatter configured.

Optional external tools: `brew install stockfish`; Ollama with `gemma3:4b`; the Codex CLI signed in with ChatGPT. The app runs without any of them, using fallbacks.

Environment variables: `PORT`, `STOCKFISH_PATH`, `CODEX_PATH`, `CHESS_COACH_MODEL`, `CHESS_COACH_DISABLED=1`, `CHESS_COACH_DATA_DIR`. Games are stored in `~/Library/Application Support/Local Chess Coach/chess-coach.sqlite` by default, so set `CHESS_COACH_DATA_DIR` when manually testing to avoid touching real games.

## Architecture

`server/index.ts` is a plain `node:http` server bound to `127.0.0.1`: REST under `/api`, push events over the `/events` WebSocket, origin checks, and zod request validation. `src/` is a small React client. `shared/types.ts` defines the contract between them, including the `ServerEvent` union. Server code imports with NodeNext `.js` suffixes.

### Move lifecycle (`server/game-service.ts`)

`GameService` owns all game state and mutations. A move is validated with chess.js and persisted immediately. Analysis, coaching, and bot replies then run in the background, so play never waits on them:

1. `runAnalysis` runs Stockfish on the before and after positions (`analysis.ts`, `uci.ts`), and `verdict.ts` turns the scores into a verdict.
2. `enqueueCoaching` adds the coaching job to a per-game promise chain, so jobs are ordered within a game and independent across games. Bot moves get coaching status `skipped`.
3. `scheduleBot` uses a separate UCI process from analysis.

**Stale work:** background results are dropped unless `isCurrentMove` still holds. Takeback and restart assign a new `branchId` and bump `revision`, and clients send `expectedRevision` on moves. Any new async step must re-fetch the game and repeat this check after each `await`.

**Persistence:** `GameState.state_json` is what gets loaded. The `moves`, `analysis`, and `coaching` tables are written on each save but not read back. At startup, `Storage` marks interrupted jobs as unavailable, and `GameService` resumes any bot game waiting on the bot.

### Coaching trust boundary

The most important invariant: **a language model never writes chess prose shown to the user.**

1. `coach-facts.ts` derives typed facts from the position using legal-move checks.
2. `coach-insights.ts` turns those facts into server-written insights, each with an ID, explanation, and lesson.
3. The model returns only `{moveId, verdict, insightId}` (`selectionSchema` in `coach.ts`).
4. `validateCoachSelection` rejects unknown IDs, extra fields, and verdict mismatches. `renderCoachSelection` then produces the displayed text.

The browser shows that text verbatim. To add coaching content, add a fact and insight on the server rather than widening the model's output. Invalid selections are retried up to 3 times by `runWithCoachRetries`; infrastructure errors fail immediately.

When hints are hidden (`hintsVisible: false`), coaching must not reveal a live next move.

### Providers and fallbacks

Everything implements `CoachProvider`. `PreferredCoachProvider` (`local-coach.ts`) tries Ollama first, then fails over to `CodexCoachProvider` (`codex app-server` over stdio) with one final attempt. A failed request only moves later requests to the cloud if the Ollama health check also fails. `refresh()` runs before each coaching job and rechecks at most every 30 seconds, returning to local once it recovers. If coaching fails or is unavailable, `fallbackCoaching` produces deterministic text. Without Stockfish, `fallbackAnalysis` gives a material-only result with the verdict "Analysis uncertain".

Codex must use managed ChatGPT auth. API-key auth is deliberately refused so the app can't create API charges; don't add API-key paths. Don't forward Codex stderr or credentials to the browser.

## Testing notes

Tests use fake providers and a temporary `Storage(dir)`, so they don't need Stockfish, Ollama, or Codex. `tests/board-layout.test.ts` asserts on literal strings in `src/styles.css` and `src/MoveCard.tsx`, so editing those files can break it.

## Other docs

- `VALIDATION.md`: observed verification results and known limitations.
- `COACHING_IMPROVEMENTS.md`: completed coaching hardening checklist.
- `chess-coach-implementation-plan.md`: original spec. Some of it is superseded; for example, it predates the local-first coach and says bot moves get coaching.
