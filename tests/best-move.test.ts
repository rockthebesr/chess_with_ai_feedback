import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findBestMove } from "../server/best-move.js";
import type { CoachProvider } from "../server/coach.js";
import { GameService } from "../server/game-service.js";
import { Storage } from "../server/storage.js";
import type { UciEngine, UciLine } from "../server/uci.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function engineWith(...lines: Array<Partial<UciLine>>): UciEngine {
  return {
    version: "fake",
    analyze: async () => ({
      bestMove: lines[0]?.moves?.[0] ?? "(none)",
      lines: lines.map((line, index) => ({ multipv: index + 1, depth: 12, moves: [], ...line })),
    }),
  } as unknown as UciEngine;
}

const offlineCoach: CoachProvider = {
  status: () => ({ available: false }),
  initialize: async () => ({ available: false }),
  coach: async () => {
    throw new Error("offline");
  },
  followUp: async () => "",
  cancel: async () => undefined,
  close: () => undefined,
};

function service(engine?: UciEngine) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chess-coach-test-"));
  dirs.push(dir);
  const storage = new Storage(dir);
  return { storage, service: new GameService(storage, offlineCoach, engine, engine, () => undefined) };
}

describe("explaining the best move", () => {
  it("names a winning capture, the evaluation, and the runner-up", async () => {
    const fen = "4k3/8/8/3p4/4P3/5P2/7P/4K3 w - - 0 1";
    const advice = await findBestMove(
      engineWith({ cp: 150, moves: ["e4d5", "e8e7", "e1e2"] }, { cp: 40, moves: ["h2h3"] }),
      fen,
    );
    expect(advice).toMatchObject({ fen, san: "exd5", from: "e4", to: "d5", line: ["exd5", "Ke7", "Ke2"] });
    expect(advice?.reasons[0]).toBe("It captures the pawn on d5, and you come out about 1 point of material ahead.");
    expect(advice?.evaluation).toBe("With this move you'd be about 1.5 pawns ahead.");
    expect(advice?.comparison).toBe("The next best move, h3, is about 1.1 pawns worse.");
  });

  it("does not claim material that the line gives back", async () => {
    const fen = "2rq1rk1/1p1n1ppp/2p5/2bnpN2/p7/1P1P2P1/P1P2PBP/R1B1QRK1 w - - 1 16";
    const advice = await findBestMove(engineWith({ cp: 65, moves: ["b3a4", "c8a8", "a1b1", "a8a4"] }), fen);
    expect(advice?.reasons[0]).toBe("It captures the pawn on a4.");
  });

  it("explains forced mates in either direction", async () => {
    const mating = await findBestMove(engineWith({ mate: 1, moves: ["a1a8"] }), "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
    expect(mating?.reasons[0]).toBe("It's checkmate.");
    expect(mating?.evaluation).toBe("You have a forced mate.");
    const mated = await findBestMove(engineWith({ mate: -2, moves: ["h2h3"] }), "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
    expect(mated?.reasons[0]).toContain("holds out the longest");
  });

  it("explains saving a piece, and uses the side to move's view of the score", async () => {
    const advice = await findBestMove(engineWith({ cp: -80, moves: ["a3b1"] }), "4kb2/8/8/8/8/N7/7P/4K3 w - - 0 1");
    expect(advice?.reasons).toContain(
      "It deals with the threat to your knight on a3, which was attacked with no defender.",
    );
    expect(advice?.evaluation).toBe("With this move you'd be about 0.8 pawns behind.");
  });

  it("admits when there's no single tactic", async () => {
    const advice = await findBestMove(
      engineWith({ cp: 10, moves: ["h2h3"] }, { cp: 5, moves: ["h2h4"] }),
      "4k3/8/8/8/8/8/7P/4K3 w - - 0 1",
    );
    expect(advice?.reasons).toEqual([
      "There's no single tactic behind it. The engine simply rates the resulting position highest.",
    ]);
    expect(advice?.evaluation).toBe("With this move the position is about level.");
    expect(advice?.comparison).toBe("h4 is about as good.");
  });

  it("returns nothing when the engine offers no usable move", async () => {
    expect(await findBestMove(engineWith(), "4k3/8/8/8/8/8/7P/4K3 w - - 0 1")).toBeUndefined();
    expect(await findBestMove(engineWith({ moves: ["a1a8"] }), "4k3/8/8/8/8/8/7P/4K3 w - - 0 1")).toBeUndefined();
  });
});

describe("asking the game for the best move", () => {
  it("answers on the player's turn even with hints off, without changing the game", async () => {
    const { service: games, storage } = service(engineWith({ cp: 20, moves: ["e2e4"] }));
    const game = games.create({ mode: "local", hintsVisible: false });
    const before = JSON.stringify(games.get(game.id));
    expect((await games.bestMove(game.id)).san).toBe("e4");
    expect(JSON.stringify(games.get(game.id))).toBe(before);
    await games.idle();
    storage.close();
  });

  it("refuses on the bot's turn, for finished positions, and for bad input", async () => {
    const { service: games, storage } = service(engineWith({ cp: 20, moves: ["e7e5"] }));
    const game = games.create({ mode: "bot", humanColor: "black", difficulty: "easy" });
    await expect(games.bestMove(game.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(games.bestMove(game.id, "not a position")).rejects.toMatchObject({ statusCode: 400 });
    await expect(games.bestMove(game.id, "R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 1 1")).rejects.toMatchObject({
      statusCode: 409,
    });
    await games.idle();
    storage.close();
  });

  it("explains that Stockfish is needed when it is missing", async () => {
    const { service: games, storage } = service();
    const game = games.create({ mode: "local" });
    await expect(games.bestMove(game.id)).rejects.toMatchObject({ statusCode: 503 });
    storage.close();
  });
});
