import { describe, expect, it } from "vitest";
import { moverLoss, verdictFor, whiteScore } from "../server/verdict.js";

describe("score orientation and verdicts", () => {
  it("normalizes engine scores to White's point of view", () => {
    expect(whiteScore({ cp: 80 }, "w").cp).toBe(80);
    expect(whiteScore({ cp: 80 }, "b").cp).toBe(-80);
    expect(whiteScore({ mate: 3 }, "b").mate).toBe(-3);
  });

  it("calculates loss from either mover's perspective", () => {
    expect(moverLoss({ cp: 50 }, { cp: -100 }, "white")).toBe(150);
    expect(moverLoss({ cp: 100 }, { cp: 180 }, "black")).toBe(80);
    expect(verdictFor({ cp: 100 }, { cp: 180 }, "black").verdict).toBe("Inaccuracy");
  });

  it("does not subtract mate scores as centipawns", () => {
    const result = verdictFor({ cp: 30 }, { mate: -2 }, "white");
    expect(result.lossCp).toBeUndefined();
    expect(result.verdict).toBe("Mistake");
  });

  it("judges a thrown-away forced mate instead of calling it uncertain", () => {
    expect(verdictFor({ mate: 3 }, { cp: 200 }, "white").verdict).toBe("Mistake");
    expect(verdictFor({ mate: -3 }, { cp: -200 }, "black").verdict).toBe("Mistake");
    expect(verdictFor({ mate: 3 }, { mate: -2 }, "white").verdict).toBe("Mistake");
    const stillWinning = verdictFor({ mate: 3 }, { cp: 900 }, "white");
    expect(stillWinning.verdict).toBe("Inaccuracy");
    expect(stillWinning.note).toContain("still winning");
  });

  it("treats keeping, creating, and delivering mate as good moves", () => {
    expect(verdictFor({ mate: 3 }, { mate: 2 }, "white").verdict).toBe("Good move");
    expect(verdictFor({ mate: 3 }, { mate: 5 }, "white").note).toContain("faster");
    expect(verdictFor({ cp: 40 }, { mate: 4 }, "white").verdict).toBe("Good move");
    expect(verdictFor({ mate: -1 }, { mate: 0 }, "black").verdict).toBe("Good move");
  });

  it("does not blame a player for a mate they could not stop", () => {
    expect(verdictFor({ mate: -3 }, { mate: -3 }, "white").verdict).toBe("Good move");
    expect(verdictFor({ mate: 3 }, { mate: 3 }, "black").verdict).toBe("Good move");
    expect(verdictFor({ mate: -5 }, { mate: -2 }, "white").verdict).toBe("Inaccuracy");
    expect(verdictFor({ mate: -3 }, { cp: -400 }, "white").note).toContain("escapes");
    expect(verdictFor({ cp: 30 }, { mate: -2 }, "white", true).verdict).toBe("Good move");
  });
});
