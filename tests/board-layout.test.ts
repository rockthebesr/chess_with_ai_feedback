import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("board layout", () => {
  it("pins all eight rows and columns to equal, shrinkable tracks", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toContain("grid-template: repeat(8, minmax(0, 1fr)) / repeat(8, minmax(0, 1fr))");
    expect(css).toMatch(/\.square \{[^}]*min-height: 0;[^}]*overflow: hidden;/);
    expect(css).toContain("calc(100dvh - 220px)");
    expect(css).toContain("height: calc(100dvh - 66px)");
    expect(css).toContain(".board-wrap.is-flipping .board");
    expect(css).toContain("transform: rotate(180deg)");
    expect(css).toContain("transition: transform 720ms");
    expect(css).toContain("cubic-bezier(.22,.8,.28,1)");
  });

  it("renders accepted server coaching without a browser-side rewrite", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("friendlyCoachCopy");
    expect(source).not.toContain("partialExplanation");
    expect(source).toContain("Coaching point");
  });
});
