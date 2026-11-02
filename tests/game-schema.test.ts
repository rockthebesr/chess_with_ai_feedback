import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoachProvider } from "../server/coach.js";
import { GameService } from "../server/game-service.js";
import { GAME_STATE_VERSION, parseGameState } from "../server/game-schema.js";
import { Storage } from "../server/storage.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const coach: CoachProvider = {
  status: () => ({ available: false }),
  initialize: async () => ({ available: false }),
  coach: async () => {
    throw new Error("offline");
  },
  followUp: async () => {
    throw new Error("offline");
  },
  cancel: async () => undefined,
  close: () => undefined,
};

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-"));
  dirs.push(dir);
  const storage = new Storage(dir);
  return { dir, storage, service: new GameService(storage, coach, undefined, undefined, () => undefined) };
}

function corrupt(dir: string, id: string, stateJson: string): void {
  const db = new DatabaseSync(path.join(dir, "chess-coach.sqlite"));
  db.prepare("UPDATE games SET state_json = ? WHERE id = ?").run(stateJson, id);
  db.close();
}

function storedJson(dir: string, id: string): string {
  const db = new DatabaseSync(path.join(dir, "chess-coach.sqlite"));
  const row = db.prepare("SELECT state_json FROM games WHERE id = ?").get(id) as { state_json: string };
  db.close();
  return row.state_json;
}

describe("saved game validation", () => {
  it("round-trips a real game, stamps its version, and keeps unknown fields", async () => {
    const { service, storage, dir } = setup();
    const game = service.create({ mode: "local" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    const saved = JSON.parse(storedJson(dir, game.id));
    expect(saved.stateVersion).toBe(GAME_STATE_VERSION);
    const { stateVersion: _stateVersion, ...legacy } = saved;
    const parsed = parseGameState(JSON.stringify({ ...legacy, futureField: 7 })) as unknown as Record<string, unknown>;
    expect(parsed.stateVersion).toBe(GAME_STATE_VERSION);
    expect(parsed.futureField).toBe(7);
    expect(storage.loadGame(game.id)?.moves[0].san).toBe("e4");
    storage.close();
  });

  it("applies migrations in order", () => {
    const { service, storage, dir } = setup();
    const game = service.create({ mode: "local" });
    const v1 = storedJson(dir, game.id);
    const steps: number[] = [];
    const table = {
      1: (state: Record<string, unknown>) => {
        steps.push(1);
        return { ...state, result: "migrated" };
      },
      2: (state: Record<string, unknown>) => {
        steps.push(2);
        return state;
      },
    };
    const parsed = parseGameState(v1, table, 3);
    expect(steps).toEqual([1, 2]);
    expect(parsed).toMatchObject({ result: "migrated", stateVersion: 3 });
    expect(() => parseGameState(v1, {}, 2)).toThrow(/No migration/);
    storage.close();
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["the wrong shape", JSON.stringify({ id: "x", moves: "none" })],
    ["a newer version", JSON.stringify({ stateVersion: GAME_STATE_VERSION + 1 })],
  ])("starts up without a game holding %s, leaving it on disk", (_label, damaged) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { service, storage, dir } = setup();
    const bad = service.create({ mode: "local" });
    const good = service.create({ mode: "local" });
    storage.close();
    corrupt(dir, bad.id, damaged);

    const reopened = new Storage(dir);
    const restarted = new GameService(reopened, coach, undefined, undefined, () => undefined);
    expect(restarted.list().map((item) => item.id)).toEqual([good.id]);
    expect(restarted.get(bad.id)).toBeUndefined();
    expect(restarted.get(good.id)?.id).toBe(good.id);
    expect(warn).toHaveBeenCalledOnce();
    reopened.close();
    expect(storedJson(dir, bad.id)).toBe(damaged);
  });
});
