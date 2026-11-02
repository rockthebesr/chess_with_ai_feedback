import { describe, expect, it } from "vitest";
import { runWithCoachRetries } from "../server/coach.js";

describe("coach selection retries", () => {
  it("allows an initial attempt plus exactly three retries", async () => {
    let attempts = 0;
    const result = await runWithCoachRetries(
      async () => ++attempts,
      (value) => (value === 4 ? [] : [`attempt ${value} failed`]),
    );
    expect(result).toBe(4);
    expect(attempts).toBe(4);
    attempts = 0;
    await expect(
      runWithCoachRetries(
        async () => ++attempts,
        () => ["still invalid"],
      ),
    ).rejects.toThrow(/after 3 retries/);
    expect(attempts).toBe(4);
  });

  it("also retries malformed model responses", async () => {
    let attempts = 0;
    const result = await runWithCoachRetries(
      async () => {
        attempts += 1;
        if (attempts < 4) throw new SyntaxError("invalid JSON");
        return "verified";
      },
      () => [],
    );
    expect(result).toBe("verified");
    expect(attempts).toBe(4);
  });

  it("fails immediately on infrastructure errors", async () => {
    let attempts = 0;
    await expect(
      runWithCoachRetries(
        async () => {
          attempts += 1;
          throw new Error("connection refused");
        },
        () => [],
      ),
    ).rejects.toThrow("connection refused");
    expect(attempts).toBe(1);
  });
});
