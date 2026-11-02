import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoachProvider } from "../server/coach.js";
import { GameService } from "../server/game-service.js";
import { Storage } from "../server/storage.js";
import type { ProviderStatus, ServerEvent } from "../shared/types.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function offlineCoach(overrides: Partial<CoachProvider> = {}): CoachProvider {
  return {
    status: () => ({ available: false, error: "offline test" }), initialize: async () => ({ available: false }),
    coach: async () => { throw new Error("offline"); }, followUp: async () => { throw new Error("offline"); },
    cancel: async () => undefined, close: () => undefined, ...overrides,
  };
}

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
  return dir;
}

describe("bot recovery", () => {
  it("resumes the bot when the server restarts on its turn", async () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const service = new GameService(storage, offlineCoach(), undefined, undefined, () => undefined);
    const game = service.create({ mode: "bot", humanColor: "white" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    const beforeReply = structuredClone(storage.loadGame(game.id)!);
    await service.idle();
    storage.saveGame(beforeReply);
    storage.close();

    const reopened = new Storage(dir);
    const restarted = new GameService(reopened, offlineCoach(), undefined, undefined, () => undefined);
    await restarted.idle();
    expect(restarted.get(game.id)?.moves).toHaveLength(2);
    expect(restarted.get(game.id)?.turn).toBe("white");
    reopened.close();
  });

  it("does not resume the bot while guided practice is paused", async () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const service = new GameService(storage, offlineCoach(), undefined, undefined, () => undefined);
    const game = service.create({ mode: "bot", humanColor: "white", practice: "guided" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    storage.close();

    const reopened = new Storage(dir);
    const restarted = new GameService(reopened, offlineCoach(), undefined, undefined, () => undefined);
    await restarted.idle();
    expect(restarted.get(game.id)?.moves).toHaveLength(1);
    reopened.close();
  });

  it("replays the bot's opening move after it is taken back", async () => {
    const storage = new Storage(tempDir());
    const service = new GameService(storage, offlineCoach(), undefined, undefined, () => undefined);
    const game = service.create({ mode: "bot", humanColor: "black" });
    await service.idle();
    expect(service.get(game.id)?.moves).toHaveLength(1);
    await service.undo(game.id);
    await service.idle();
    expect(service.get(game.id)?.moves).toHaveLength(1);
    expect(service.get(game.id)?.turn).toBe("black");
    storage.close();
  });
});

describe("interrupted job recovery", () => {
  it("clears pending jobs in games that had already finished", async () => {
    const dir = tempDir();
    const storage = new Storage(dir);
    const service = new GameService(storage, offlineCoach(), undefined, undefined, () => undefined);
    const game = service.create({ mode: "local" });
    const moved = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    const moveId = moved.moves[0].id;
    await service.idle();
    const finished = structuredClone(storage.loadGame(game.id)!);
    finished.status = "complete"; finished.result = "1-0";
    finished.analysis[moveId].status = "pending";
    finished.coaching[moveId] = { moveId, status: "queued" };
    storage.saveGame(finished);
    storage.close();

    const reopened = new Storage(dir);
    const recovered = reopened.loadGame(game.id)!;
    expect(recovered.analysis[moveId].status).toBe("unavailable");
    expect(recovered.coaching[moveId].status).toBe("unavailable");
    reopened.close();
  });
});

describe("coach availability during play", () => {
  const output = { moveId: "", verdict: "Good move" as const, explanation: "verified", lesson: "verified" };

  it("uses a coach that becomes available after startup and announces it", async () => {
    let status: ProviderStatus = { available: false, error: "offline" };
    const events: ServerEvent[] = [];
    const coach = offlineCoach({
      status: () => status,
      refresh: async () => { status = { available: true, authMode: "local", model: "gemma3:4b" }; return status; },
      coach: async (_game, move) => ({ ...output, moveId: move.id }),
    });
    const storage = new Storage(tempDir());
    const service = new GameService(storage, coach, undefined, undefined, (event) => events.push(event));
    const game = service.create({ mode: "local" });
    const moved = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    expect(service.get(game.id)?.coaching[moved.moves[0].id].status).toBe("complete");
    expect(events).toContainEqual({ type: "provider.updated", provider: status });
    storage.close();
  });

  it("credits the provider that actually answered", async () => {
    const coach = offlineCoach({
      status: () => ({ available: true, authMode: "local", model: "gemma3:4b" }),
      coach: async (_game, move) => ({ ...output, moveId: move.id, source: { available: true, authMode: "chatgpt", model: "gpt-5.6-luna" } }),
    });
    const storage = new Storage(tempDir());
    const service = new GameService(storage, coach, undefined, undefined, () => undefined);
    const game = service.create({ mode: "local" });
    const moved = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    expect(service.get(game.id)?.coaching[moved.moves[0].id]).toMatchObject({ provider: "Codex App Server", model: "gpt-5.6-luna" });
    storage.close();
  });
});
