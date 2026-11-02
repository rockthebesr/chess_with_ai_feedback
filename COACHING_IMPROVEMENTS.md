# Coaching reliability improvements

This document tracks the gaps found in the 2026-09-30 coaching review. A gap is marked closed only after its implementation and automated failure-mode tests pass.

## Implementation checklist

- [x] Replace free-form factual coaching with typed, preverified insight selection and deterministic rendering. The model can return only `moveId`, `verdict`, and one supplied `insightId`; unexpected fields and unknown IDs are rejected.
- [x] Expand the verified position model with material deltas, legal attackers and defenders, loose/newly loose/rescued pieces, new attacks, forks, pins/skewers/x-rays, development, castling, and central-pawn facts.
- [x] Replace the geometric “protects the king” approximation with legal-move-aware defensive facts. Coaching no longer infers king safety from proximity; it makes a king-safety claim only for verified events such as castling or check.
- [x] Remove the browser-side coaching rewrite that could substitute stale opening guidance for verified server output. The browser displays the accepted server explanation and lesson verbatim.
- [x] Keep three retries for invalid selections, fail fast on infrastructure errors, and isolate coaching queues per game. A cloud failover gets one final attempt rather than another retry cycle.
- [x] Add request-time local-to-cloud failover when the local provider becomes unhealthy or cannot produce a valid selection. Cancellation never triggers failover.
- [x] Distinguish opening-name coverage from plan coverage and do not present generic plans as opening-specific knowledge. Unsupported lines show the verified name but explicitly defer strategy to current-board facts.
- [x] Reject verdict mismatches before accepting a model selection; verdicts are never repaired after acceptance.

## Required verification

- [x] Unit tests for typed insight generation and rendering.
- [x] Tactical-position tests for captures, loose pieces, legal defenders, development, castling, forks, line motifs, and invented relationships.
- [x] Adversarial output tests for unknown insight IDs, injected prose, wrong verdicts, malformed JSON, and exhausted retries.
- [x] Retry tests proving validation failures receive three retries while infrastructure failures fail immediately.
- [x] Provider tests proving request-time failover, bounded failover attempts, and cancellation behavior.
- [x] Queue tests proving one game's slow coaching does not block another game.
- [x] UI policy tests proving displayed coaching is the accepted server text and uses a neutral coaching label.
- [x] Opening tests proving unsupported openings are named without fabricated opening-specific plans.
- [x] Full test, typecheck, and production-build passes.

## Completion result

Closed on 2026-09-30. The factual trust boundary now ends at deterministic server rendering: a language model cannot add chess prose to a coaching card or follow-up answer. If all allowed selections fail validation, the app uses a server-generated verified fallback and play continues.

## Out of scope

- Deployment, hosting, multiplayer networking, or other iteration 2 work.
