import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { classifyMistake, summarizePatterns } from "../server/patterns.js";
import type { AnalysisRecord, GameSettings, GameState, MoveRecord, Verdict } from "../shared/types.js";

let nextId = 0;
function playedMove(fen: string, from: string, to: string): MoveRecord {
  const chess = new Chess(fen);
  const played = chess.move({ from, to });
  nextId += 1;
  return { id: `m${nextId}`, gameId: "g", branchId: "b", revision: 1, ply: 1, mover: played.color === "w" ? "white" : "black", beforeFen: fen, afterFen: chess.fen(), san: played.san, uci: `${from}${to}`, createdAt: "" };
}

function bad(extra: Partial<AnalysisRecord> = {}, verdict: Verdict = "Blunder"): AnalysisRecord {
  return { moveId: "m", status: "complete", verdict, budgetMs: 450, engine: "test", alternatives: [], ...extra };
}

const quiet = () => playedMove(new Chess().fen(), "a2", "a3");

function finished(entries: Array<{ move: MoveRecord; analysis: AnalysisRecord }>, settings: Partial<GameSettings> = {}, status: GameState["status"] = "complete"): GameState {
  return {
    status, settings: { mode: "local", whiteName: "Ann", blackName: "Bea", humanColor: "white", ...settings },
    moves: entries.map((entry) => entry.move), analysis: Object.fromEntries(entries.map((entry) => [entry.move.id, entry.analysis])),
  } as unknown as GameState;
}

describe("classifying mistakes", () => {
  it("recognizes mate patterns from the mover's side", () => {
    expect(classifyMistake(quiet(), bad({ beforeCp: 20, afterMate: -3 }))).toBe("allowed-mate");
    expect(classifyMistake(quiet(), bad({ beforeMate: 2, afterCp: 300 }))).toBe("missed-mate");
    const black = playedMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1", "a7", "a6");
    expect(classifyMistake(black, bad({ beforeCp: -20, afterMate: 3 }))).toBe("allowed-mate");
  });

  it("recognizes undefended and outranked pieces", () => {
    expect(classifyMistake(playedMove("4k3/8/4p3/8/8/8/3Q4/4K3 w - - 0 1", "d2", "d5"), bad())).toBe("left-undefended");
    expect(classifyMistake(playedMove("4k3/8/4p3/8/8/8/3Q4/3RK3 w - - 0 1", "d2", "d5"), bad())).toBe("attacked-by-cheaper");
  });

  it("recognizes captures allowed and missed", () => {
    const move = playedMove("4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1", "e1", "e2");
    expect(classifyMistake(move, bad({ continuation: { id: "reply", uci: ["d5d4", "c3e4"], san: [] } }))).toBe("other");
    const ignoresThreat = playedMove("4kb2/8/8/8/8/N7/7P/4K3 w - - 0 1", "h2", "h3");
    expect(classifyMistake(ignoresThreat, bad({ continuation: { id: "reply", uci: ["f8a3", "e1e2"], san: [] } }))).toBe("allowed-capture");
    expect(classifyMistake(quiet(), bad({ alternatives: [{ id: "v1", uci: [], san: ["Nxe5"] }] }))).toBe("missed-capture");
  });
});

describe("tallying patterns", () => {
  const entry = (extra: Partial<AnalysisRecord> = {}, verdict?: Verdict, move = quiet()) => ({ move, analysis: bad(extra, verdict) });

  it("counts mistakes and blunders per player, most common first, with other last", () => {
    const [ann] = summarizePatterns([finished([
      entry({ afterMate: -3 }), entry({ afterMate: -2 }, "Mistake"), entry(),
      entry({ beforeCp: 0 }, "Inaccuracy"), entry({}, "Good move"),
    ])]);
    expect(ann).toMatchObject({ name: "Ann", games: 1, mistakes: 3 });
    expect(ann.patterns.map((item) => [item.id, item.count, item.share])).toEqual([["allowed-mate", 2, 67], ["other", 1, 33]]);
    expect(ann.patterns[0].label).toBe("Allowed a forced mate");
  });

  it("sorts other last even when it is the most common", () => {
    const [ann] = summarizePatterns([finished([entry(), entry(), entry({ afterMate: -3 })])]);
    expect(ann.patterns.map((item) => item.id)).toEqual(["allowed-mate", "other"]);
  });

  it("adds up across games and keeps two local players apart", () => {
    const whiteMove = entry();
    const blackMove = entry({}, undefined, playedMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1", "a7", "a6"));
    const result = summarizePatterns([finished([whiteMove, blackMove]), finished([entry()])]);
    expect(result.find((player) => player.name === "Ann")).toMatchObject({ games: 2, mistakes: 2 });
    expect(result.find((player) => player.name === "Bea")).toMatchObject({ games: 1, mistakes: 1 });
  });

  it("ignores the bot, unfinished games, and unanalyzed moves", () => {
    const botMove = entry({}, undefined, playedMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1", "a7", "a6"));
    const botGame = finished([botMove, { move: quiet(), analysis: bad({ status: "unavailable" }) }], { mode: "bot", humanColor: "white", blackName: "Coach Bot" });
    expect(summarizePatterns([botGame])).toEqual([{ name: "Ann", games: 1, mistakes: 0, patterns: [] }]);
    expect(summarizePatterns([finished([entry()], {}, "active")])).toEqual([]);
  });
});
