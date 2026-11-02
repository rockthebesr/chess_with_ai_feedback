import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

describe("consequential chess rules", () => {
  it("rejects illegal moves and permits castling", () => {
    const chess = new Chess();
    expect(() => chess.move({ from: "e2", to: "e5" })).toThrow();
    for (const san of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]) chess.move(san);
    expect(chess.move("O-O").san).toBe("O-O");
  });

  it("handles en passant", () => {
    const chess = new Chess();
    for (const san of ["e4", "a6", "e5", "d5"]) chess.move(san);
    const move = chess.move("exd6");
    expect(move.flags).toContain("e");
    expect(chess.get("d5")).toBeUndefined();
  });

  it("requires and applies promotion choice", () => {
    const chess = new Chess("8/P7/8/8/8/8/7k/5K2 w - - 0 1");
    expect(chess.move({ from: "a7", to: "a8", promotion: "n" }).promotion).toBe("n");
    expect(chess.get("a8")?.type).toBe("n");
  });

  it("detects mate and legitimate drawn positions", () => {
    const mate = new Chess();
    for (const san of ["f3", "e5", "g4", "Qh4#"]) mate.move(san);
    expect(mate.isCheckmate()).toBe(true);
    expect(new Chess("8/8/8/8/8/8/7k/5K2 w - - 0 1").isInsufficientMaterial()).toBe(true);
    expect(new Chess("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1").isStalemate()).toBe(true);
  });
});
