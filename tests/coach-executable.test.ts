import { describe, expect, it } from "vitest";
import { findCodexExecutable, selectCoachModel } from "../server/coach.js";

describe("Codex executable discovery", () => {
  it("finds the ChatGPT-bundled Codex binary on this Mac", () => {
    expect(findCodexExecutable()).toMatch(/codex$/);
  });

  it("prefers the most efficient coaching model over the account default", () => {
    const models = [{ id: "gpt-6-astra", isDefault: true }, { id: "gpt-5.6-sol" }, { id: "gpt-5.6-luna" }];
    expect(selectCoachModel(models)?.id).toBe("gpt-5.6-luna");
    expect(selectCoachModel(models, "gpt-5.6-luna")?.id).toBe("gpt-5.6-luna");
  });
});
