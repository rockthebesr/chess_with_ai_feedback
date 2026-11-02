# Local Chess Coach — Implementation Plan

## 1. Executor brief

Build a personal chess learning app for Rock and his wife Christine. This document is the agreed implementation specification. Implement iteration 1 first; design interfaces to allow iteration 2 without building its infrastructure now.

Proceed autonomously with routine implementation choices. Inspect the repository and applicable AGENTS.md instructions before editing. If starting from an empty directory, initialize a normal TypeScript project. Honor existing conventions if a suitable project already exists. Do not deploy, publish, or create a remote repository unless separately instructed.

First prove subscription-backed coaching works on the user's Mac through the documented Codex integration. Do not silently replace it with a paid API, automate the ChatGPT website, extract credentials, or use undocumented endpoints. If account access is unavailable, complete the offline chess functionality and explain the specific integration blocker.

Deliver working code, setup instructions, relevant tests, and an honest validation report. Keep credentials, game databases, and personal data out of Git.

## 2. Goal and scope

Provide a responsive chess game with brief, accurate coaching after every move, helping beginners understand moves and openings while playing.

Iteration 1 runs locally on a Mac in a browser at localhost. The board, rules, chess engine, and saved games operate locally. Natural-language coaching uses an internet connection and the user's ChatGPT subscription through Codex. It is not a fully offline AI app.

### Required play modes

- Human vs bot, with adjustable difficulty and choice of color.
- Human vs human on one computer, including Rock vs Christine.
- Short coaching after every move by either player, including bot moves.
- Shared coaching in human vs human mode so both players learn.

### Iteration 1 features

- Interactive board with click-to-move and drag-and-drop, legal-move highlights, last-move indication, check indication, and promotion selection.
- Move history, current turn, game result, and clear analysis/coaching status.
- Manual board flip and optional automatic flip after each turn in shared-computer mode. Manual flip is the default.
- Untimed games by default. No chess clocks in iteration 1.
- Guided practice mode with optional pause for feedback; normal play mode that does not wait for coaching.
- Takebacks, restart, resign, and appropriate draw handling.
- Opening identification, variation names when supported, plans, strengths, weaknesses, and beginner mistakes.
- Brief per-move feedback, expandable engine lines, and follow-up questions.
- Save/resume games locally, browse completed games, export PGN, and review alternatives after a game.
- Postgame summary with a few key moments and practical lessons.
- Continued play when coaching is unavailable or subscription limits are reached.

### Deferred

- Two-laptop network multiplayer, accounts, matchmaking, ratings, clocks, voice, mobile-native apps, public hosting, and advanced longitudinal learning analytics.
- ChatGPT choosing bot moves. The v1 opponent is Stockfish; ChatGPT is the coach. A later optional bot policy may ask ChatGPT to select from verified engine candidates.

## 3. User experience

### Start game

Choose play mode, player names, color for bot games, difficulty, normal play or guided practice, and board-flip preference. Remember settings locally.

Suggested difficulty labels: Beginner, Easy, Medium, Strong. Do not claim precise Elo unless the chosen engine settings support it and their limitations are communicated.

### Per-move feedback

Each accepted move gets a persistent card linked to that exact move, containing:

1. A short verdict, such as “Good move,” “Inaccuracy,” “Mistake,” or “Analysis uncertain.”
2. One or two sentences explaining the main consequence in beginner-friendly language.
3. One actionable lesson when useful, without inventing a criticism for sound moves.
4. An optional “Show me” action to illustrate a verified continuation on a review board.

Example tone: “Your knight develops toward the center. But it stops protecting your bishop, allowing Black to win it next move. Before moving, check what your piece was defending.” This is an illustrative example, not a rule to repeat.

Avoid walls of text, unexplained chess jargon, repetitive praise, and presenting shallow engine analysis as certain. Address the player who made the move. Preserve both players' cards in human vs human mode.

### Coaching versus hints

Explain the move that was just played. Hide explicit suggested next moves by default during human vs human play. A shared-hints setting lets both players opt into live candidate moves and lines. Follow-up answers in this mode must obey the same setting. Opening plans can be discussed, but do not expose a concrete best-next-move line through opening guidance when hints are hidden.

Engine lines and best alternatives may be revealed during postgame review. Revealing an alternative to a move just played can disclose a tactic still available in the current position, so apply the hints policy to “Show me” during live play too.

### Timing

Normal play accepts the next move and lets the bot respond without waiting for AI text. Feedback remains in move history even if several moves have been played by the time it arrives. Show which move is being analyzed.

Guided practice pauses turn progression after a move until the player chooses Continue. If coaching fails, Continue must still work. In human vs human mode, this is a shared learning pause.

## 4. Recommended technical architecture

| Layer | Default choice | Responsibility |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | Board, move list, coaching, review, settings |
| Board component | Maintained React chessboard component | Display and input only; never authoritative rules |
| Local backend | Node.js, TypeScript, lightweight HTTP framework | Authoritative game state, workers, storage, AI integration |
| Rules | chess.js | Legal moves, SAN, FEN, PGN, state detection |
| Engine | Native Stockfish via UCI | Bot move selection and position analysis |
| Coaching | Codex App Server | Subscription authentication and streamed natural-language responses |
| Storage | SQLite | Games, moves, analysis, coaching, settings |
| Browser updates | WebSocket | State, engine progress, and coaching events |
| Validation | Runtime schemas, such as Zod | API input and AI output validation |

Use a single repository with shared TypeScript domain types. Choose maintained dependency versions during implementation and commit the lockfile. Check licenses for distributed dependencies and opening data. If distributing Stockfish later, fulfill its applicable license requirements.

Run separate engine workers/processes for bot play and analysis so strong coaching analysis does not weaken the opponent's difficulty setting or block its response. Limit resource use and shut down child processes cleanly.

Suggested modules:

- `game`: authoritative rules, turn transitions, takebacks, results.
- `engine`: UCI process lifecycle, command queue, parsing, cancellation.
- `analysis`: before/after evaluation, alternatives, verdicts.
- `openings`: local opening database and matching.
- `coach`: provider interface, Codex adapter, prompts, validation, scheduling.
- `storage`: schema, migrations, repository functions.
- `transport`: local HTTP/WebSocket endpoints and typed events.
- `ui`: board, coaching history, opening panel, review, settings.

## 5. ChatGPT subscription integration

Use documented Codex App Server functionality with managed ChatGPT sign-in. Relevant official documentation:

- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/auth

The documented app-server supports ChatGPT authentication, threads/turns, streaming events, and account rate-limit information. These are the intended integration primitives, not a guarantee that every account/model will be available. Verify current documentation and installed CLI capabilities at implementation time.

### Integration spike — do first

1. Check/install the documented Codex CLI with the user's existing environment conventions.
2. Launch app-server as a backend-managed child process using its documented transport.
3. Initialize the protocol and complete managed ChatGPT login, or reuse an existing supported login.
4. Confirm subscription auth is active; do not silently fall back to an API key found in the environment.
5. Send a compact known chess analysis packet and receive a coaching answer.
6. Verify streaming, error handling, cancellation, and usage-limit reporting where supported.
7. Measure response latency and record the result.

Keep account tokens under Codex's managed authentication rather than exposing them to the browser or placing them in the application database. Use a dedicated minimal runtime context and the least permissions the integration supports. The coach needs text inference, not repository editing, arbitrary shell execution, or web browsing. Verify these restrictions rather than relying only on a prompt.

Use a configurable available model; do not hardcode a speculative model name. No separate API spending without explicit user authorization.

Define a provider interface so a future authorized API or local-model provider can be added without changing chess logic. A disabled provider and deterministic engine-feedback fallback are needed in v1; implementing additional providers is not.

## 6. Game state and event flow

The backend owns game state. Frontend inputs express move intent; the backend validates and commits it.

For each move:

1. Verify game ID, expected revision, turn, game status, and move legality.
2. Commit the move and persist its before/after position, SAN/UCI notation, player, ply, and revision.
3. Emit the updated state immediately.
4. Queue local analysis and opening detection.
5. Publish engine feedback as soon as ready.
6. Queue coaching using the verified analysis packet.
7. Stream text into a clearly marked pending card; finalize only after validation.
8. Schedule a bot reply when allowed by play mode and the guided-practice pause.

Use immutable move IDs plus a game revision/branch identifier. A FEN alone is not a sufficient identity: repetition history and different game branches matter.

Maintain a bounded, serialized coaching queue initially. Every committed move should have a feedback record; queued move jobs should not be dropped simply because another move occurs. Faster play may create a visible backlog. Do not imply AI text will always arrive instantly.

On undo or restart, invalidate jobs for removed moves, cancel work where possible, and ignore late events. Historical results for retained moves remain valid. Follow-up requests carry the specific move/position context. Give interactive questions reasonable scheduling priority without corrupting the per-move queue.

## 7. Engine analysis and verdicts

Stockfish provides chess calculations. The coach explains those findings rather than independently inventing tactical conclusions.

Analyze the position before the played move and the resulting position with comparable resource budgets. Compare the best available move against the played move from the mover's perspective. Normalize side-to-move engine scores consistently. Keep centipawn scores and mate scores distinct; do not subtract mate scores as ordinary numbers.

Use strong analysis settings independently of weakened bot settings. Obtain a small set of alternative lines when useful. Validate all displayed continuations with the rules library, converting UCI to SAN from the correct starting position.

Implement a documented, configurable heuristic for verdict labels. Label them as the app's estimates, not official Chess.com or Lichess classifications. Avoid simplistic material claims based solely on evaluation swings. If budgets are shallow, scores unstable, or mate handling ambiguous, show uncertainty and soften the explanation.

Initial responsiveness target: board updates immediately; a first engine result around one second on the user's Mac. This is a target to benchmark, not a promise. Bound engine analysis time and CPU usage; optional deeper analysis can come later.

Test explicitly: evaluation sign for both colors, moves escaping/allowing mate, promotion, castling, en passant, forced moves, and legitimate draw outcomes. Respect repetition history and distinguish claimable draws from automatic draws according to the implemented rules policy.

## 8. Opening recognition

Use a local, licensed opening dataset with documented provenance and ECO codes where available. Match played move sequences and normalized positions; position matching should account for transpositions and relevant castling/en-passant state rather than full raw FEN counters.

Return the deepest supported match, including opening name, variation when known, ECO code, matched ply, and match method. Multiple names can map to the same position; use a documented selection rule.

If the game leaves the database, say “Last recognized opening: …; now outside the stored line.” Do not claim the game has no opening simply because an exact sequence was not found, and do not let the LLM invent an unsupported variation name.

Generate a concise opening card when a recognized opening or meaningful variation changes:

- Typical plans for White and Black.
- Main strengths and tradeoffs, without claiming an opening guarantees an advantage.
- One or two common beginner mistakes.

Use curated opening notes where available and let the model adapt the language. Tactical statements must be grounded in engine analysis. Cache reusable opening explanations by opening, language, hints policy, and prompt version. Avoid repeating unchanged guidance after every move.

## 9. Coach contract

Input packet includes:

- Game/move IDs, branch revision, mover, and beginner level.
- Before/after FEN, played SAN/UCI, compact recent move history, and current game status.
- Normalized before/after engine scores, analysis budget, verified candidate lines, and heuristic verdict.
- Recognized opening information and approved notes.
- Hint visibility policy, game mode, and relevant follow-up question.

Output fields should include `moveId`, `verdict`, `explanation`, `lesson`, and optional references to supplied variation IDs. Opening explanation is a separate event/card when needed.

Use schema-constrained output if the installed integration supports it. Otherwise require a compact JSON format, validate it, and make at most one bounded repair attempt before falling back. Do not assume an app-server feature exists without checking its current schema.

Prefer referencing verified variation IDs over accepting free-form invented moves. Validate output identity, length, allowed verdict values, move references, and hints policy. Legal validation catches impossible moves but does not prove all prose claims; prompt grounding and representative quality checks are still necessary.

Treat player names and user questions as data, not instructions that override the coaching policy. Never expose internal prompts or authentication details through follow-up answers.

## 10. Persistence and review

Suggested entities:

- Games: ID, mode, players, settings, initial position, result, timestamps.
- Moves: immutable ID, game ID, branch/revision, ply, mover, before/after FEN, SAN/UCI.
- Analysis: move ID, engine version/settings, scores, alternatives, verdict, status.
- Coaching: move ID, provider/model, prompt version, finalized structured response, status/error.
- Opening events: game/move ID, opening identifier, explanation.
- Settings: local preferences without credentials.

Use schema migrations. Store the database in an appropriate user-data location outside tracked source files. Do not require accounts.

Persist accepted moves immediately. On restart, restore games and mark unfinished analysis/coaching jobs for safe recovery; avoid duplicating finalized coaching. Persist completed coaching, not every token.

PGN export must contain a valid main line and correct result. Optional annotations may be supported. Postgame variation exploration uses a separate review state and never mutates the recorded game. Generate postgame summaries from completed analysis, acknowledging any missing results.

## 11. Local security and operation

Bind the backend to loopback by default. Validate WebSocket/HTTP origins and inputs, do not enable unrestricted CORS, and keep the backend inaccessible from the LAN in iteration 1. Use a same-origin development proxy or equally simple arrangement.

Do not expose credentials in browser bundles, logs, exported PGNs, or Git. Log useful latency and error metadata without dumping authentication data. Cleanly terminate engine and Codex child processes when the app exits.

Provide one documented startup command after dependency installation. Document Node prerequisites, Stockfish setup, ChatGPT sign-in, data location, troubleshooting, and how to run without coaching. Prefer clear failure states over hanging spinners.

## 12. Implementation milestones

### Milestone 0 — integration proof

Prove subscription login and a grounded streamed response. Measure latency and validate available protocol features. Record blockers before committing to the provider implementation.

### Milestone 1 — playable offline app

Implement authoritative rules, board, two play modes, bot difficulty, promotion, game endings, flip, undo/restart, and basic persistence. Complete a game without any AI connection.

### Milestone 2 — verified analysis and openings

Implement UCI workers, analysis packets, verdict heuristics, verified lines, opening database matching, and quick engine feedback. Check score orientation and opening transpositions.

### Milestone 3 — coaching workflow

Connect the provider, validate responses, stream pending cards, handle per-move queues, implement guided practice, hints policy, follow-up questions, failure fallback, and cancellation after takebacks.

### Milestone 4 — review and polish

Add game browsing/resume, PGN export, separate postgame variation exploration, opening guidance, postgame recap, startup documentation, and UI accessibility/polish.

At each milestone run relevant checks. Do not build v2 infrastructure to complete v1.

## 13. Validation and acceptance criteria

Use unit/integration tests for consequential chess logic, UCI parsing, event identity, persistence, and provider boundaries; avoid tests that merely duplicate simple UI implementation. Use mocked AI responses for repeatable tests and a small live smoke test when account access exists.

Iteration 1 is complete when:

- Rock can finish a game against the bot with adjustable difficulty.
- Rock and Christine can finish an untimed game on one laptop, with feedback for both players.
- Illegal moves are rejected and special moves work correctly.
- Recognized openings show accurate database names and short guidance; unknown lines are described honestly.
- Normal play stays responsive while coaching queues; guided practice pauses and resumes reliably.
- Live human vs human feedback respects hidden-hint mode, including follow-up chat and opening guidance.
- Undo/restart cannot attach stale coaching or bot moves to a new branch.
- Offline or rate-limited coaching does not prevent play.
- Games survive app restart, PGN exports are valid, and review variations preserve the main game.
- A documented ChatGPT-authenticated live coaching smoke test passes, or that requirement is explicitly reported as blocked rather than described as complete.
- Type checking, production build, relevant automated tests, and manual browser flows pass.

Manual quality checks should include a sound developing move, an undefended piece, a simple fork, mate, a forced reply, and an opening transposition. Check explanations against the supplied engine evidence and beginner readability.

## 14. Iteration 2 — two laptops

Goal: Rock and Christine join the same private game from separate laptops, with synchronized moves, shared coaching, and independent board orientation.

GitHub stores source code; it does not itself supply the multiplayer backend. GitHub Pages can host a static frontend, but a running backend is still required for game authority, synchronization, native Stockfish, and coaching.

Before implementation, choose between a backend on Rock's Mac with deliberate private-network access, or an appropriate hosted backend. Do not expose the v1 server by merely changing its bind address. Hosted subscription authentication, supported use, token storage, and account limits require fresh verification before deployment.

Add private rooms/invitations, seat ownership, authenticated or securely scoped player sessions, server-authoritative turns, reconnect/resync, duplicate-move protection, shared history, and secure transport. Do not put subscription credentials in either laptop's frontend or a public repository. Determine whose coaching account is used before enabling shared service access.

The existing backend authority, event protocol, game revisions, and provider boundary should make this extension straightforward. Public matchmaking and a commercial multi-user AI service remain outside scope.

## 15. Required executor handoff

When finished, provide:

1. What works and any incomplete requirements.
2. Exact setup and startup commands for the Mac.
3. How to sign in for coaching and verify subscription rather than API billing.
4. Tests/checks performed and observed coaching latency.
5. Where local game data lives and how to export it.
6. Any material dependency/license or integration limitations.

Implement the agreed v1 scope. Ask only when a material blocker or a decision outside this specification requires the user's input.
