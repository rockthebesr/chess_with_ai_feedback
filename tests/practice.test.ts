import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoachProvider } from "../server/coach.js";
import { GameService } from "../server/game-service.js";
import { Storage } from "../server/storage.js";
import type { UciEngine } from "../server/uci.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_A3 = "rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1";
const AFTER_H3 = "rnbqkbnr/pppppppp/8/8/8/7P/PPPPPPP1/RNBQKBNR b KQkq - 0 1";

// a3 is the "bad" move, h3 is merely poor, e4 is the engine's top choice, and d4 is equally fine.
function setup(humanColor?: "white") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-"));
  dirs.push(dir);
  const storage = new Storage(dir);
  let broken = false;
  const engine = {
    version: "fake",
    analyze: async (fen: string) => {
      if (broken) throw new Error("engine down");
      const cp = fen === AFTER_A3 ? 600 : fen === AFTER_H3 ? 150 : 0;
      return { bestMove: "e2e4", lines: [{ multipv: 1, depth: 10, cp, moves: fen === START ? ["e2e4"] : ["e7e5"] }] };
    },
  } as unknown as UciEngine;
  const service = new GameService(storage, coach, engine, engine, () => undefined);
  return {
    service,
    storage,
    breakEngine: () => {
      broken = true;
    },
    game: service.create(humanColor ? { mode: "bot", humanColor } : { mode: "local" }),
  };
}

async function finishedAfterA3(context: ReturnType<typeof setup>) {
  await context.service.move(context.game.id, { from: "a2", to: "a3", expectedRevision: 0 });
  await context.service.idle();
  context.service.resign(context.game.id, "white");
  await context.service.idle();
  return context.service.practicePositions(context.game.id);
}

describe("practicing your own mistakes", () => {
  it("offers nothing until the game is over", async () => {
    const context = setup();
    await context.service.move(context.game.id, { from: "a2", to: "a3", expectedRevision: 0 });
    await context.service.idle();
    expect(context.service.practicePositions(context.game.id)).toEqual([]);
    await expect(
      context.service.practiceAttempt(context.game.id, context.service.get(context.game.id)!.moves[0].id, {
        from: "e2",
        to: "e4",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    context.storage.close();
  });

  it("offers the position before each bad move", async () => {
    const context = setup();
    expect(await finishedAfterA3(context)).toMatchObject([
      { fen: START, mover: "white", playedSan: "a3", verdict: "Blunder", bestSan: "e4" },
    ]);
    context.storage.close();
  });

  it("leaves out the bot's mistakes", async () => {
    const context = setup("white");
    await context.service.move(context.game.id, { from: "e2", to: "e4", expectedRevision: 0 });
    await context.service.idle();
    const live = context.service.get(context.game.id)!;
    for (const move of live.moves) if (move.mover === "black") live.analysis[move.id].verdict = "Blunder";
    context.service.resign(context.game.id, "white");
    await context.service.idle();
    expect(context.service.practicePositions(context.game.id)).toEqual([]);
    context.storage.close();
  });

  it("scores attempts without changing the recorded game", async () => {
    const context = setup();
    const [position] = await finishedAfterA3(context);
    const attempt = (from: string, to: string) =>
      context.service.practiceAttempt(context.game.id, position.moveId, { from, to });
    const before = JSON.stringify(context.service.get(context.game.id));
    expect(await attempt("a2", "a3")).toMatchObject({
      solved: false,
      san: "a3",
      explanation: expect.stringContaining("you played in the game"),
    });
    expect(await attempt("e2", "e4")).toMatchObject({
      solved: true,
      explanation: expect.stringContaining("top choice"),
    });
    expect(await attempt("d2", "d4")).toMatchObject({ solved: true, san: "d4" });
    expect(await attempt("h2", "h3")).toMatchObject({
      solved: false,
      explanation: "h3 would be a mistake here. Try another move.",
    });
    expect(JSON.stringify(context.service.get(context.game.id))).toBe(before);
    context.storage.close();
  });

  it("rejects illegal moves and unknown positions", async () => {
    const context = setup();
    const [position] = await finishedAfterA3(context);
    await expect(
      context.service.practiceAttempt(context.game.id, position.moveId, { from: "e2", to: "e5" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      context.service.practiceAttempt(context.game.id, "nope", { from: "e2", to: "e4" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    context.storage.close();
  });

  it("reports an engine failure instead of marking the attempt wrong", async () => {
    const context = setup();
    const [position] = await finishedAfterA3(context);
    context.breakEngine();
    await expect(
      context.service.practiceAttempt(context.game.id, position.moveId, { from: "d2", to: "d4" }),
    ).rejects.toMatchObject({ statusCode: 503 });
    context.storage.close();
  });

  it("rejects a result that lands after the game was taken back", async () => {
    const context = setup();
    const [position] = await finishedAfterA3(context);
    const pending = context.service.practiceAttempt(context.game.id, position.moveId, { from: "d2", to: "d4" });
    await context.service.undo(context.game.id);
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
    context.storage.close();
  });
});
