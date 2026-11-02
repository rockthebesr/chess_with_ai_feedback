# Iteration 1 validation report

Validation date: 2026-09-30 (America/New_York)

## Subscription-backed coaching proof

Verified first, before application implementation, using the installed Codex CLI (`codex-cli 0.155.0-alpha.2.6`) and the documented App Server stdio protocol.

- `account/read` reported managed `chatgpt` authentication and ChatGPT `plus` plan metadata.
- `model/list` returned account-available models; the app selects from this runtime list rather than assuming a model.
- `account/rateLimits/read` returned successfully.
- A known `1. e4` packet with before/after FEN, a verified candidate line, centipawn scores, hidden-hint policy, and a JSON output schema produced a valid grounded coaching object.
- Streaming produced 68 text deltas. First text arrived in 3,323 ms; the structured answer completed in 4,648 ms.
- The result preserved `moveId`, agreed with the supplied “Good move” verdict, explained central control and development, and did not reveal a concrete next move.
- App Server turn cancellation is implemented with documented `turn/interrupt`; stale-event rejection is additionally enforced with move ID, revision, and branch identity.
- The completed application server was then tested over its real loopback WebSocket: 91 streaming coaching events, first stream event in 1,251 ms, and a finalized grounded response in 8,158 ms.

Official reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Automated checks

- `npm test`: 10 files, 52 tests passed.
- `npm run typecheck`: frontend and backend strict TypeScript checks passed.
- `npm run build`: production client and server build passed.
- `npm audit`: 0 vulnerabilities after upgrading the development test runner to its patched major release.

Coverage focuses on consequential boundaries:

- Legal-move rejection, castling, en passant, underpromotion, checkmate, stalemate, and insufficient material.
- White/Black score orientation, mover-relative centipawn loss, and distinct mate handling.
- UCI centipawn/mate and multi-PV parsing.
- Full ECO position-book lookup, transpositions, a London System move-order match, and nearest-known-opening fallback after leaving theory.
- Immediate persistence, stale revisions, guided Continue while coaching is offline, branch replacement after undo, and restart recovery.
- Human-only AI coaching in bot games, retained local analysis for bot moves, and cascading saved-game deletion.
- Coaching cards and follow-ups use typed insight selection: the model cannot supply explanation or lesson prose. Tests reject injected prose, unknown insight IDs, and verdict mismatches before rendering.
- Tactical fact tests cover captures, material changes, legal attackers and defenders, loose pieces, development, castling, newly attacked pieces, forks, and line motifs.
- Coaching failure tests additionally cover a queen falsely reported as exchanged, the wrong captured piece, false check and promotion claims, nonexistent pieces, false protection relationships, malformed JSON, all three validation retries, immediate infrastructure failure, request-time provider failover, cancellation, and cross-game queue isolation.

## Local integration checks

- Stockfish 19 installed with Homebrew at the standard Apple-silicon path.
- Two separate UCI process objects are used for bot play and analysis; each is limited to one thread and 32 MB hash.
- Loopback-only HTTP/WebSocket binding and origin checks are enabled.
- Production dependency audit passed with no findings.
- A resigned one-move game exported as PGN, parsed back through `chess.js`, retained the `1-0` result, and had no duplicate result marker.
- Ollama 0.35.0 is installed as a local background service and Gemma 3 4B (3.3 GB) is downloaded.
- The app health check reports `Free local` / `gemma3:4b` as the active coach. A real temporary `1. e4` game produced a completed, beginner-friendly coaching card through the application API; the test game was then deleted.
- After coaching hardening, an isolated production server on port 4273 again completed a temporary `1. e4` game through Local Gemma. The model selected the verified `central-pawn` insight, the server rendered the factual explanation and lesson, and the test game was deleted.
- The local Gemma coach is selected first and the ChatGPT-backed coach stays available as an automatic fallback when the local service or model is unavailable.

## Manual browser checklist

The final browser pass covers:

- New human-vs-bot and local two-player games.
- Click-to-move, drag/drop, legal destination markers, last move, check, board flip, and promotion dialog.
- Normal-play responsiveness and guided Continue.
- Takeback, restart, resign, agreed draw, automatic game endings, save/resume, and PGN export.
- Opening card, per-move queue states, engine details, hidden live lines, follow-up questions, postgame recap, and separate review board.
- Coaching-disabled behavior without blocked play.
- Bookmarkable game URLs survive a full refresh and restore the same 20-ply game.
- The board rendered as a 601 × 601 square at a 1465 × 821 viewport; controls ended at 800 px and the document remained exactly 821 px high, so no page scroll was required.
- Forest, walnut, slate, and high-contrast boards plus classic, solid, and letter-token pieces are available from setup and the in-game Appearance menu.

## Known limitations, not iteration 2 work

- Opening names come from the bundled ECO database, so uncommon or very recent named lines can still be absent or classified differently across chess references. The app uses the deepest matching named position and labels positions outside the book as such.
- Node's built-in SQLite API emits an experimental warning on this installed Node release. It passed persistence/recovery tests, but a future Node upgrade may require a compatibility review.
- Natural-language latency depends on the signed-in account, model availability, network, and rate limits; 4.65 seconds is one observed smoke test, not a guarantee.
- Local Gemma coaching requires the Ollama service and uses 3.3 GB of disk space for the model; its quality is intentionally focused on short, friendly explanations while Stockfish remains the source of chess analysis.
- No deployment or two-laptop networking was added.
