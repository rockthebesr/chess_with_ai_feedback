import { describe, expect, it } from "vitest";
import { materialFromFen, materialSummary } from "../src/material";

const names = { white: "Ann", black: "Bea" };

describe("counting material", () => {
  it("starts even with nothing captured", () => {
    expect(materialFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toEqual({
      whiteLead: 0,
      capturedBy: { white: [], black: [] },
    });
  });

  it("scores captures and lists them most valuable first", () => {
    // White has taken Black's queen and a pawn. Black has taken a knight.
    const material = materialFromFen("rnb1kbnr/ppp1pppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1");
    expect(material.whiteLead).toBe(9 + 1 - 3);
    expect(material.capturedBy).toEqual({ white: ["q", "p"], black: ["n"] });
  });

  it("counts a promoted queen in the score without inventing a capture", () => {
    const material = materialFromFen("4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1");
    expect(material.whiteLead).toBe(18);
    expect(material.capturedBy.black).toEqual(
      ["q", "r", "r", "b", "b", "n", "n", "p", "p", "p", "p", "p", "p", "p", "p"].slice(1),
    );
    expect(material.capturedBy.white).toEqual([
      "q",
      "r",
      "r",
      "b",
      "b",
      "n",
      "n",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
      "p",
    ]);
  });
});

describe("describing material", () => {
  it("speaks to the player in a bot game, from either color", () => {
    expect(materialSummary(3, names, "white")).toBe("You're up 3 points of material");
    expect(materialSummary(3, names, "black")).toBe("You're down 3 points of material");
    expect(materialSummary(-1, names, "black")).toBe("You're up 1 point of material");
  });

  it("names the leader in a two-player game", () => {
    expect(materialSummary(2, names)).toBe("Ann is up 2 points of material");
    expect(materialSummary(-5, names)).toBe("Bea is up 5 points of material");
  });

  it("says when it is even", () => {
    expect(materialSummary(0, names, "white")).toBe("Material is even");
  });
});
