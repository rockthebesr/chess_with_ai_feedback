import { describe, expect, it } from "vitest";
import { recognizeOpening } from "../server/openings.js";

describe("opening recognition", () => {
  it("returns the deepest sequence match", () => {
    const result = recognizeOpening(["e4", "e5", "Nf3", "Nc6", "Bc4"]);
    expect(result?.name).toBe("Italian Game");
    expect(result?.matchedPly).toBe(5);
  });

  it("returns a supported variation name", () => {
    const result = recognizeOpening(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
    expect(result?.variation).toBe("Giuoco Piano");
    expect(result?.guidanceAvailable).toBe(false);
  });

  it("recognizes a transposed Queen's Gambit Declined position", () => {
    const result = recognizeOpening(["d4", "e6", "c4", "d5"]);
    expect(result?.name).toBe("Queen's Gambit Declined");
    expect(result?.matchMethod).toBe("position");
  });

  it("recognizes the London System in its common move orders", () => {
    const classical = recognizeOpening(["d4", "d5", "Nf3", "Nf6", "Bf4"]);
    const flexible = recognizeOpening(["d4", "Nf6", "Nf3", "d5", "Bf4"]);
    expect(classical?.name).toMatch(/London System/);
    expect(classical?.current).toBe(true);
    expect(flexible?.name).toMatch(/London System/);
    expect(flexible?.current).toBe(true);
    expect(classical?.guidanceAvailable).toBe(true);
  });

  it("retains the last recognized opening outside its stored line", () => {
    const result = recognizeOpening(["e4", "c5", "a3"]);
    expect(result?.name).toMatch(/Sicilian Defense/);
    expect(result?.current).toBe(true);
  });
});
