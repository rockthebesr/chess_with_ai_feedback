import { describe, expect, it } from "vitest";
import { parseInfo } from "../server/uci.js";

describe("UCI parsing", () => {
  it("parses centipawn multi-PV output", () => {
    expect(parseInfo("info depth 16 multipv 2 score cp -37 nodes 1000 pv e2e4 e7e5")).toEqual({
      multipv: 2,
      depth: 16,
      cp: -37,
      mate: undefined,
      moves: ["e2e4", "e7e5"],
    });
  });

  it("keeps mate distinct from centipawns", () => {
    const parsed = parseInfo("info depth 20 score mate 3 pv h7h8q");
    expect(parsed?.mate).toBe(3);
    expect(parsed?.cp).toBeUndefined();
  });
});
