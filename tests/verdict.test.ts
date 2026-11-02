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
});
