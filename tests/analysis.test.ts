import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { analyzeMove } from "../server/analysis.js";
import type { UciEngine, UciLine } from "../server/uci.js";
import type { MoveRecord } from "../shared/types.js";

function playedMove(fen: string, from: string, to: string): MoveRecord {
  const chess = new Chess(fen);
  const played = chess.move({ from, to });
  return { id: "m", gameId: "g", branchId: "b", revision: 1, ply: 1, mover: played.color === "w" ? "white" : "black", beforeFen: fen, afterFen: chess.fen(), san: played.san, uci: `${from}${to}`, createdAt: "" };
}

function engineWith(lines: Record<string, Partial<UciLine>>): { engine: UciEngine; searched: string[] } {
  const searched: string[] = [];
  const engine = { version: "fake", analyze: async (fen: string) => {
    searched.push(fen);
    const line = lines[fen];
    return { bestMove: line?.moves?.[0] ?? "(none)", lines: line ? [{ multipv: 1, depth: 12, moves: [], ...line }] : [] };
  } } as unknown as UciEngine;
  return { engine, searched };
}

describe("analyzing finished games", () => {
  it("scores checkmate from the rules because the engine returns no line", async () => {
    const move = playedMove("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "a1", "a8");
    const { engine, searched } = engineWith({ [move.beforeFen]: { mate: 1, moves: ["a1a8"] } });
    const result = await analyzeMove(engine, move, 15);
    expect(result).toMatchObject({ status: "complete", verdict: "Good move", afterMate: 0, note: "The move delivers checkmate." });
    expect(result.continuation).toBeUndefined();
    expect(searched).toEqual([move.beforeFen]);
  });

  it("marks stalemating a winning position as a loss of the win", async () => {
    const move = playedMove("7k/8/5K2/6Q1/8/8/8/8 w - - 0 1", "g5", "g6");
    const { engine } = engineWith({ [move.beforeFen]: { mate: 1, moves: ["g5g7"] } });
    const result = await analyzeMove(engine, move, 20);
    expect(result).toMatchObject({ status: "complete", verdict: "Blunder", afterCp: 0 });
  });
});
