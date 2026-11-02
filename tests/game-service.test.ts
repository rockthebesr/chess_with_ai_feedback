import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoachProvider } from "../server/coach.js";
import { GameService, ServiceError } from "../server/game-service.js";
import { Storage } from "../server/storage.js";
import type { UciEngine } from "../server/uci.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
  const storage = new Storage(dir);
  const coach: CoachProvider = {
    status: () => ({ available: false, error: "offline test" }), initialize: async () => ({ available: false }),
    coach: async () => { throw new Error("offline"); }, followUp: async () => { throw new Error("offline"); },
    cancel: async () => undefined, close: () => undefined,
  };
  const service = new GameService(storage, coach, undefined, undefined, () => undefined);
  return { service, storage, dir };
}

describe("authoritative game service", () => {
  it("commits legal moves immediately and rejects stale or illegal intent", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local", practice: "normal" });
    const moved = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    expect(moved.moves[0].san).toBe("e4");
    expect(storage.loadGame(game.id)?.moves).toHaveLength(1);
    await expect(service.move(game.id, { from: "e7", to: "e5", expectedRevision: 0 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.move(game.id, { from: "e7", to: "e3", expectedRevision: 1 })).rejects.toBeInstanceOf(ServiceError);
    await service.idle();
    storage.close();
  });

  it("pauses guided practice but Continue works without coaching", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local", practice: "guided" });
    const moved = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    expect(moved.paused).toBe(true);
    const continued = await service.continue(game.id, moved.revision);
    expect(continued.paused).toBe(false);
    await service.idle();
    storage.close();
  });

  it("changes branch identity on undo and does not retain removed feedback", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local" }); const branch = game.branchId;
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    const undone = await service.undo(game.id);
    expect(undone.branchId).not.toBe(branch); expect(undone.moves).toHaveLength(0); expect(Object.keys(undone.coaching)).toHaveLength(0);
    await service.idle();
    storage.close();
  });

  it("clears opening state when a game is restarted", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local" });
    const moved = await service.move(game.id, { from: "d2", to: "d4", expectedRevision: 0 });
    expect(moved.opening).toBeDefined();
    const restarted = await service.restart(game.id);
    expect(restarted.moves).toHaveLength(0);
    expect(restarted.opening).toBeUndefined();
    await service.idle(); storage.close();
  });

  it("survives a storage restart", async () => {
    const { service, storage, dir } = setup();
    const game = service.create({ mode: "local" });
    await service.move(game.id, { from: "d2", to: "d4", expectedRevision: 0 });
    await service.idle();
    storage.close();
    const reopened = new Storage(dir);
    expect(reopened.loadGame(game.id)?.moves[0].san).toBe("d4");
    reopened.close();
  });

  it("ignores late coaching after a takeback", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
    const storage = new Storage(dir);
    let finish: ((value: { moveId: string; verdict: "Good move"; explanation: string; lesson: string }) => void) | undefined;
    let cancelled = false;
    const coach: CoachProvider = {
      status: () => ({ available: true, model: "mock" }), initialize: async () => ({ available: true }),
      coach: async () => await new Promise((resolve) => { finish = (value) => resolve(value); }),
      followUp: async () => "", cancel: async () => { cancelled = true; }, close: () => undefined,
    };
    const service = new GameService(storage, coach, undefined, undefined, () => undefined);
    const game = service.create({ mode: "local" });
    const moved = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    const moveId = moved.moves[0].id;
    await new Promise((resolve) => setImmediate(resolve));
    const undone = await service.undo(game.id);
    expect(cancelled).toBe(true);
    finish?.({ moveId, verdict: "Good move", explanation: "late", lesson: "late" });
    await service.idle();
    expect(undone.moves).toHaveLength(0); expect(Object.keys(undone.coaching)).toHaveLength(0);
    storage.close();
  });

  it("ignores a late bot move after undo changes the branch", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
    const storage = new Storage(dir);
    const coach: CoachProvider = {
      status: () => ({ available: false }), initialize: async () => ({ available: false }), coach: async () => { throw new Error(); },
      followUp: async () => "", cancel: async () => undefined, close: () => undefined,
    };
    let release: ((result: { bestMove: string; lines: [] }) => void) | undefined;
    const bot = { analyze: async () => await new Promise((resolve) => { release = resolve; }) } as unknown as UciEngine;
    const service = new GameService(storage, coach, undefined, bot, () => undefined);
    const game = service.create({ mode: "bot", humanColor: "white", practice: "normal" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    const undone = await service.undo(game.id);
    release?.({ bestMove: "e7e5", lines: [] });
    await service.idle();
    expect(undone.moves).toHaveLength(0); expect(undone.turn).toBe("white");
    storage.close();
  });

  it("keeps review variations separate from the recorded main line", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    const before = service.get(game.id)!.pgn;
    const review = service.review(game.id, 1, [{ from: "e7", to: "e5" }]);
    expect(review.sans).toEqual(["e5"]); expect(service.get(game.id)!.pgn).toBe(before);
    await service.idle(); storage.close();
  });

  it("runs AI coaching for the human move but skips the bot move", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
    const storage = new Storage(dir);
    let coachingCalls = 0;
    const coach: CoachProvider = {
      status: () => ({ available: true, model: "mock" }), initialize: async () => ({ available: true }),
      coach: async (_game, move) => { coachingCalls += 1; return { moveId: move.id, verdict: "Good move", explanation: "Human lesson", lesson: "Keep going" }; },
      followUp: async () => "", cancel: async () => undefined, close: () => undefined,
    };
    const bot = { version: "mock bot", analyze: async () => ({ bestMove: "e7e5", lines: [] }) } as unknown as UciEngine;
    const service = new GameService(storage, coach, undefined, bot, () => undefined);
    const game = service.create({ mode: "bot", humanColor: "white", practice: "normal" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    const finished = service.get(game.id)!;
    expect(finished.moves.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(coachingCalls).toBe(1);
    expect(finished.coaching[finished.moves[0].id].status).toBe("complete");
    expect(finished.coaching[finished.moves[1].id].status).toBe("skipped");
    expect(finished.analysis[finished.moves[1].id].status).toBe("unavailable");
    storage.close();
  });

  it("does not let slow coaching in one game block another game", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
    const storage = new Storage(dir);
    let releaseFirst: (() => void) | undefined;
    let firstGameId = "";
    const coach: CoachProvider = {
      status: () => ({ available: true, model: "mock" }), initialize: async () => ({ available: true }),
      coach: async (game, move) => {
        if (game.id === firstGameId) await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return { moveId: move.id, verdict: "Analysis uncertain", explanation: `done ${game.id}`, lesson: "verified" };
      },
      followUp: async () => "", cancel: async () => undefined, close: () => undefined,
    };
    const service = new GameService(storage, coach, undefined, undefined, () => undefined);
    const first = service.create({ mode: "local" }); firstGameId = first.id;
    const second = service.create({ mode: "local" });
    await service.move(first.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.move(second.id, { from: "d2", to: "d4", expectedRevision: 0 });
    for (let i = 0; i < 10 && service.get(second.id)!.coaching[service.get(second.id)!.moves[0].id].status !== "complete"; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(service.get(first.id)!.coaching[service.get(first.id)!.moves[0].id].status).toBe("streaming");
    expect(service.get(second.id)!.coaching[service.get(second.id)!.moves[0].id].status).toBe("complete");
    releaseFirst?.();
    await service.idle(); storage.close();
  });

  it("deletes a saved game and its persisted state", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    await service.delete(game.id);
    expect(service.get(game.id)).toBeUndefined();
    expect(storage.loadGame(game.id)).toBeUndefined();
    expect(service.list().some((item) => item.id === game.id)).toBe(false);
    storage.close();
  });

  it("deletes every saved game and its persisted state", async () => {
    const { service, storage } = setup();
    const first = service.create({ mode: "local" });
    const second = service.create({ mode: "local" });
    expect(await service.deleteAll()).toBe(2);
    expect(service.list()).toEqual([]);
    expect(service.get(first.id)).toBeUndefined();
    expect(storage.loadGame(second.id)).toBeUndefined();
    storage.close();
  });

  it("reports accuracy and evaluation per color from the stored scores", async () => {
    const scores: Record<string, number> = {};
    const engine = { version: "fake", analyze: async (fen: string) => ({ bestMove: "e2e4", lines: [{ multipv: 1, depth: 10, cp: scores[fen] ?? 0, moves: [] }] }) } as unknown as UciEngine;
    const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
    const storage = new Storage(dir);
    const coach: CoachProvider = { status: () => ({ available: false }), initialize: async () => ({ available: false }), coach: async () => { throw new Error("offline"); }, followUp: async () => { throw new Error("offline"); }, cancel: async () => undefined, close: () => undefined };
    const service = new GameService(storage, coach, engine, undefined, () => undefined);
    const game = service.create({ mode: "local" });
    const first = await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    // Black then blunders: after e5, White (to move) sees +900.
    scores["rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"] = 900;
    await service.move(game.id, { from: "e7", to: "e5", expectedRevision: first.revision });
    await service.idle();
    const summary = service.postgameSummary(game.id);
    expect(summary.accuracy.white).toBe(100);
    expect(summary.accuracy.black).toBeLessThan(20);
    expect(summary.evaluation.map((point) => point.ply)).toEqual([1, 2]);
    expect(summary.evaluation[0].whiteWinChance).toBe(50);
    expect(summary.evaluation[1].whiteWinChance).toBeGreaterThan(90);
    storage.close();
  });

  it("leaves accuracy empty when no move has engine analysis", async () => {
    const { service, storage } = setup();
    const game = service.create({ mode: "local" });
    await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await service.idle();
    expect(service.postgameSummary(game.id)).toMatchObject({ accuracy: {}, evaluation: [], missing: 1 });
    storage.close();
  });

  describe("post-game verdict recheck", () => {
    // Scores keyed by search budget, so the longer pass can disagree with the live one.
    function recheckSetup(scoreFor: (fen: string, ms: number) => number) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-")); dirs.push(dir);
      const storage = new Storage(dir);
      const coached: string[] = [];
      const coach: CoachProvider = {
        status: () => ({ available: true, authMode: "local", model: "test" }), initialize: async () => ({ available: true }),
        coach: async (_game, move, analysis) => { coached.push(`${move.san}:${analysis.verdict}`); return { moveId: move.id, verdict: analysis.verdict, explanation: `about ${analysis.verdict}`, lesson: "lesson" }; },
        followUp: async () => "answer", cancel: async () => undefined, close: () => undefined,
      };
      const searches: number[] = [];
      const engine = {
        version: "fake",
        analyze: async (fen: string, ms: number) => {
          searches.push(ms);
          return { bestMove: "e2e4", lines: [{ multipv: 1, depth: 10, cp: scoreFor(fen, ms), moves: [] }] };
        },
      } as unknown as UciEngine;
      return { service: new GameService(storage, coach, engine, engine, () => undefined), storage, coached, searches };
    }
    const LONG = 1500;
    // Scores are from the side to move, so White loses 400 after e4 when Black then sees +400.
    const afterE4 = (fen: string) => fen.includes(" b ");

    it("replaces a verdict the longer search disagrees with and re-coaches it", async () => {
      const { service, storage, coached } = recheckSetup((fen, ms) => afterE4(fen) && ms < LONG ? 400 : 0);
      const game = service.create({ mode: "local" });
      await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
      await service.idle();
      expect(service.get(game.id)!.analysis[service.get(game.id)!.moves[0].id].verdict).toBe("Blunder");
      service.resign(game.id, "white");
      await service.idle();
      const finished = service.get(game.id)!; const move = finished.moves[0];
      expect(finished.analysis[move.id]).toMatchObject({ verdict: "Good move", rechecked: true, budgetMs: LONG });
      expect(coached).toEqual(["e4:Blunder", "e4:Good move"]);
      expect(finished.coaching[move.id].explanation).toBe("about Good move");
      expect(storage.loadGame(game.id)!.analysis[move.id].rechecked).toBe(true);
      storage.close();
    });

    it("keeps follow-up answers when a move is re-coached", async () => {
      const { service, storage } = recheckSetup((fen, ms) => afterE4(fen) && ms < LONG ? 400 : 0);
      const game = service.create({ mode: "local" });
      await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
      await service.idle();
      await service.ask(game.id, service.get(game.id)!.moves[0].id, "Why?");
      service.resign(game.id, "white");
      await service.idle();
      const finished = service.get(game.id)!;
      expect(finished.coaching[finished.moves[0].id].followups).toHaveLength(1);
      storage.close();
    });

    it("skips clearly good moves and does not re-coach an unchanged verdict", async () => {
      const { service, storage, coached, searches } = recheckSetup(() => 0);
      const game = service.create({ mode: "local" });
      await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
      await service.idle();
      service.resign(game.id, "white");
      await service.idle();
      expect(searches).not.toContain(LONG);
      expect(coached).toHaveLength(1);
      storage.close();
    });

    it("drops a recheck when the finished game is taken back", async () => {
      const { service, storage } = recheckSetup((fen) => afterE4(fen) ? 400 : 0);
      const game = service.create({ mode: "local" });
      await service.move(game.id, { from: "e2", to: "e4", expectedRevision: 0 });
      await service.idle();
      const moveId = service.get(game.id)!.moves[0].id;
      service.resign(game.id, "white");
      await service.undo(game.id);
      await service.idle();
      const latest = service.get(game.id)!;
      expect(latest.moves).toHaveLength(0);
      expect(latest.analysis[moveId]).toBeUndefined();
      storage.close();
    });
  });
});
