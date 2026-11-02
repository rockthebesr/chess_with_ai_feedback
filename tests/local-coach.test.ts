import { describe, expect, it } from "vitest";
import { PreferredCoachProvider } from "../server/local-coach.js";
import type { CoachProvider } from "../server/coach.js";
import type { AnalysisRecord, GameState, MoveRecord } from "../shared/types.js";

const game = { settings: { hintsVisible: false } } as GameState;
const move = { id: "m" } as MoveRecord;
const analysis = { verdict: "Good move" } as AnalysisRecord;

function provider(overrides: Partial<CoachProvider> = {}): CoachProvider {
  return {
    status: () => ({ available: true, authMode: "local" }), initialize: async () => ({ available: true }),
    coach: async () => ({ moveId: "m", verdict: "Good move", explanation: "ok", lesson: "ok" }),
    followUp: async () => "ok", cancel: async () => undefined, close: () => undefined, ...overrides,
  };
}

describe("preferred coach request failover", () => {
  it("falls back to cloud when an initialized local provider fails a request", async () => {
    let cloudInitialized = 0;
    let cloudRetries: number | undefined;
    const local = provider({ coach: async () => { throw new Error("local drafts exhausted"); } });
    const cloud = provider({ initialize: async () => { cloudInitialized += 1; return { available: true, authMode: "chatgpt" }; }, coach: async (_game, _move, _analysis, _opening, _delta, retries) => { cloudRetries = retries; return { moveId: "m", verdict: "Good move", explanation: "cloud", lesson: "verified" }; } });
    const preferred = new PreferredCoachProvider(local, cloud);
    await preferred.initialize();
    const result = await preferred.coach(game, move, analysis, undefined, () => undefined);
    expect(result.explanation).toBe("cloud");
    expect(cloudInitialized).toBe(1);
    expect(cloudRetries).toBe(0);
  });

  it("does not fail over a cancelled local request", async () => {
    let cloudCalls = 0;
    const local = provider({ coach: async () => { throw new DOMException("cancelled", "AbortError"); } });
    const cloud = provider({ initialize: async () => { cloudCalls += 1; return { available: true }; } });
    const preferred = new PreferredCoachProvider(local, cloud);
    await preferred.initialize();
    await expect(preferred.coach(game, move, analysis, undefined, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
    expect(cloudCalls).toBe(0);
  });

  it("stays on local when a healthy local provider only fails one request", async () => {
    let localCalls = 0;
    const local = provider({ coach: async () => { localCalls += 1; throw new Error("invalid selection"); } });
    const cloud = provider({ status: () => ({ available: true, authMode: "chatgpt" }) });
    const preferred = new PreferredCoachProvider(local, cloud);
    await preferred.initialize();
    const result = await preferred.coach(game, move, analysis, undefined, () => undefined);
    expect(result.source?.authMode).toBe("chatgpt");
    expect(preferred.status().authMode).toBe("local");
    await preferred.coach(game, move, analysis, undefined, () => undefined);
    expect(localCalls).toBe(2);
  });

  it("switches to cloud when local is down, then returns once local recovers", async () => {
    let healthy = true;
    const local = provider({
      status: () => ({ available: healthy, authMode: "local" }),
      initialize: async () => ({ available: healthy, authMode: "local" }),
      coach: async () => { healthy = false; throw new Error("connection refused"); },
    });
    const cloud = provider({ status: () => ({ available: true, authMode: "chatgpt" }) });
    const preferred = new PreferredCoachProvider(local, cloud, 0);
    await preferred.initialize();
    await preferred.coach(game, move, analysis, undefined, () => undefined);
    expect(preferred.status().authMode).toBe("chatgpt");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await preferred.refresh();
    expect(preferred.status().authMode).toBe("chatgpt");
    healthy = true;
    await new Promise((resolve) => setTimeout(resolve, 2));
    await preferred.refresh();
    expect(preferred.status().authMode).toBe("local");
  });

  it("limits how often an unavailable coach is rechecked", async () => {
    let probes = 0;
    const down = { available: false, error: "down" };
    const local = provider({ status: () => down, initialize: async () => { probes += 1; return down; } });
    const cloud = provider({ status: () => down, initialize: async () => down });
    const preferred = new PreferredCoachProvider(local, cloud, 60_000);
    await preferred.initialize();
    await preferred.refresh();
    await preferred.refresh();
    expect(probes).toBe(1);
  });

  it("does not recheck while local is healthy", async () => {
    let probes = 0;
    const local = provider({ initialize: async () => { probes += 1; return { available: true }; } });
    const preferred = new PreferredCoachProvider(local, provider(), 0);
    await preferred.initialize();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await preferred.refresh();
    expect(probes).toBe(1);
  });
});
