import { z } from "zod";
import type { GameState } from "../shared/types.js";

export const GAME_STATE_VERSION = 1;

type RawState = Record<string, unknown>;
/** Keyed by the version a migration upgrades from. Add one whenever a change would make older saved games fail the schema below. */
const migrations: Record<number, (state: RawState) => RawState> = {};

const verdict = z.enum(["Good move", "Inaccuracy", "Mistake", "Blunder", "Analysis uncertain"]);
const color = z.enum(["white", "black"]);

const moveRecord = z.looseObject({
  id: z.string(),
  gameId: z.string(),
  branchId: z.string(),
  revision: z.number(),
  ply: z.number(),
  mover: color,
  beforeFen: z.string(),
  afterFen: z.string(),
  san: z.string(),
  uci: z.string(),
  createdAt: z.string(),
});
const analysisRecord = z.looseObject({
  moveId: z.string(),
  status: z.enum(["pending", "complete", "unavailable", "cancelled"]),
  verdict,
  budgetMs: z.number(),
  engine: z.string(),
  alternatives: z.array(z.looseObject({ id: z.string(), uci: z.array(z.string()), san: z.array(z.string()) })),
});
const coachingRecord = z.looseObject({
  moveId: z.string(),
  status: z.enum(["queued", "streaming", "complete", "verified-fallback", "unavailable", "cancelled", "skipped"]),
});
const gameState = z.looseObject({
  id: z.string(),
  branchId: z.string(),
  revision: z.number(),
  settings: z.looseObject({}),
  fen: z.string(),
  turn: color,
  status: z.enum(["active", "complete"]),
  result: z.string(),
  paused: z.boolean(),
  pgn: z.string(),
  moves: z.array(moveRecord),
  legalMoves: z.array(z.looseObject({ from: z.string(), to: z.string() })),
  analysis: z.record(z.string(), analysisRecord),
  coaching: z.record(z.string(), coachingRecord),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Parses a stored game, upgrading older versions. Throws rather than letting a damaged or newer game into the app. */
export function parseGameState(json: string, table = migrations, currentVersion = GAME_STATE_VERSION): GameState {
  let state = JSON.parse(json) as RawState;
  let version = typeof state?.stateVersion === "number" ? state.stateVersion : 1;
  if (version > currentVersion) throw new Error(`Saved by a newer version of the app (state version ${version}).`);
  while (version < currentVersion) {
    const migrate = table[version];
    if (!migrate) throw new Error(`No migration from state version ${version}.`);
    state = migrate(state);
    version += 1;
  }
  return gameState.parse({ ...state, stateVersion: currentVersion }) as unknown as GameState;
}
