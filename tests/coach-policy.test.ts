import { describe, expect, it } from "vitest";
import { buildCoachPrompt, hasUnverifiedMoveAdvice, isNerdyCoaching, isTautologicalCoaching, runWithCoachRetries, validateCoachOutput, revealsCandidate } from "../server/coach.js";
import { buildCoachingFacts } from "../server/coach-facts.js";
import { Chess } from "chess.js";
import type { AnalysisRecord, MoveRecord } from "../shared/types.js";

const analysis: AnalysisRecord = {
  moveId: "m1", status: "complete", verdict: "Good move", budgetMs: 450, engine: "test",
  alternatives: [{ id: "v1", uci: ["e7e5", "g1f3"], san: ["e5", "Nf3"], scoreCp: 20 }],
};

const move: MoveRecord = { id: "m1", gameId: "g", branchId: "b", revision: 1, ply: 1, mover: "white", beforeFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", afterFen: "", san: "e4", uci: "e2e4", createdAt: "" };

describe("hidden-hint follow-up policy", () => {
  it("detects supplied live candidates in a follow-up answer", () => {
    expect(revealsCandidate("You should play e5 next.", analysis, "e4")).toBe(true);
    expect(revealsCandidate("Develop pieces and protect your king.", analysis, "e4")).toBe(false);
  });

  it("asks for friendly plan-based coaching and rejects engine-report language", () => {
    const prompt = buildCoachPrompt({ opening: { name: "London System" }, engine: { lossCp: 64 } }, "Hide live moves.");
    expect(prompt).toContain("naturally name it");
    expect(prompt).toContain("Never mention centipawns");
    expect(prompt).toContain("Next time");
    expect(isNerdyCoaching("Nh6 loses 64 centipawns and changes the evaluation.")).toBe(true);
    expect(isNerdyCoaching("That made your bishop harder to develop. Next time, finish developing first.")).toBe(false);
    expect(isTautologicalCoaching("BxB3 trades your bishop for a pawn and doesn't immediately improve your position.")).toBe(true);
  });

  it("rejects hallucinated concrete advice when hints are hidden", () => {
    expect(hasUnverifiedMoveAdvice("Next time, consider moving your queen to e5.", move, analysis, false)).toBe(true);
    expect(hasUnverifiedMoveAdvice("Next time, consider moving your pawn to e4 for the same central idea.", move, analysis, false)).toBe(false);
  });

  it("requires a legal engine alternative when hints are visible", () => {
    expect(hasUnverifiedMoveAdvice("Next time, move your queen to e5.", move, analysis, true)).toBe(true);
    expect(hasUnverifiedMoveAdvice("Next time, move your pawn to e4.", move, { ...analysis, alternatives: [{ id: "v1", uci: ["e2e4"], san: ["e4"] }] }, true)).toBe(false);
  });

  it("rejects a false claim that the mover exchanged a queen which remains on the board", () => {
    const beforeFen = "4k3/8/8/8/8/8/r7/R2Q2K1 w - - 0 1";
    const chess = new Chess(beforeFen);
    const played = chess.move({ from: "a1", to: "a2" });
    const captureMove: MoveRecord = { ...move, beforeFen, afterFen: chess.fen(), san: played.san, uci: "a1a2" };
    const mistake: AnalysisRecord = { ...analysis, verdict: "Mistake", alternatives: [] };
    const facts = buildCoachingFacts(captureMove, mistake);
    const errors = validateCoachOutput({
      moveId: "m1", verdict: "Mistake",
      explanation: "You've exchanged your queen for their bishop, so your queen is gone.",
      lesson: "Next time, check what is actually being captured.", evidenceIds: ["capture", "material_after"],
    }, captureMove, mistake, facts, false);
    expect(facts.afterCounts.wq).toBe(1);
    expect(facts.capturedPiece).toBe("rook");
    expect(errors.join(" ")).toMatch(/material trade claim is false|queen loss claim is false/);
  });

  it("accepts a factual description of the same capture", () => {
    const beforeFen = "4k3/8/8/8/8/8/r7/R2Q2K1 w - - 0 1";
    const chess = new Chess(beforeFen);
    const played = chess.move({ from: "a1", to: "a2" });
    const captureMove: MoveRecord = { ...move, beforeFen, afterFen: chess.fen(), san: played.san, uci: "a1a2" };
    const mistake: AnalysisRecord = { ...analysis, verdict: "Mistake", alternatives: [] };
    const facts = buildCoachingFacts(captureMove, mistake);
    expect(validateCoachOutput({
      moveId: "m1", verdict: "Mistake",
      explanation: "Your rook captured Black's rook on a2; your queen is still on the board.",
      lesson: "Next time, check whether the capturing rook will be safe afterward.", evidenceIds: ["capture", "material_after"],
    }, captureMove, mistake, facts, false)).toEqual([]);
  });

  it("rejects wrong captured-piece, check, and evidence claims", () => {
    const beforeFen = "4k3/8/8/8/8/8/r7/R2Q2K1 w - - 0 1";
    const chess = new Chess(beforeFen);
    const played = chess.move({ from: "a1", to: "a2" });
    const captureMove: MoveRecord = { ...move, beforeFen, afterFen: chess.fen(), san: played.san, uci: "a1a2" };
    const facts = buildCoachingFacts(captureMove, analysis);
    const errors = validateCoachOutput({
      moveId: "m1", verdict: "Good move",
      explanation: "Your rook captured Black's bishop and gave check.",
      lesson: "Next time, confirm the target and resulting threats.", evidenceIds: ["made_up_fact"],
    }, captureMove, analysis, facts, false).join(" ");
    expect(errors).toMatch(/evidenceIds/);
    expect(errors).toMatch(/capture claim is false/);
    expect(errors).toMatch(/check claim is false/);
  });

  it("rejects a false promotion claim", () => {
    const beforeFen = "4k3/P7/8/8/8/8/8/6K1 w - - 0 1";
    const chess = new Chess(beforeFen);
    const played = chess.move({ from: "a7", to: "a8", promotion: "q" });
    const promotionMove: MoveRecord = { ...move, beforeFen, afterFen: chess.fen(), san: played.san, uci: "a7a8q" };
    const facts = buildCoachingFacts(promotionMove, analysis);
    const errors = validateCoachOutput({
      moveId: "m1", verdict: "Good move", explanation: "The pawn promoted to a rook.",
      lesson: "Later, use the new piece while keeping the king safe.", evidenceIds: ["promotion"],
    }, promotionMove, analysis, facts, false);
    expect(errors.join(" ")).toMatch(/promotion claim is false/);
  });

  it("allows an initial attempt plus exactly three retries", async () => {
    let attempts = 0;
    const result = await runWithCoachRetries(async () => ++attempts, (value) => value === 4 ? [] : [`attempt ${value} failed`]);
    expect(result).toBe(4);
    expect(attempts).toBe(4);
    attempts = 0;
    await expect(runWithCoachRetries(async () => ++attempts, () => ["still invalid"])).rejects.toThrow(/after 3 retries/);
    expect(attempts).toBe(4);
  });

  it("also retries malformed model responses", async () => {
    let attempts = 0;
    const result = await runWithCoachRetries(async () => {
      attempts += 1;
      if (attempts < 4) throw new SyntaxError("invalid JSON");
      return "verified";
    }, () => []);
    expect(result).toBe("verified");
    expect(attempts).toBe(4);
  });

  it("fails immediately on infrastructure errors", async () => {
    let attempts = 0;
    await expect(runWithCoachRetries(async () => { attempts += 1; throw new Error("connection refused"); }, () => [])).rejects.toThrow("connection refused");
    expect(attempts).toBe(1);
  });

  it("rejects a false claim that a central pawn directly protects its king", () => {
    const chess = new Chess(move.beforeFen);
    const played = chess.move({ from: "e2", to: "e4" });
    const e4Move: MoveRecord = { ...move, afterFen: chess.fen(), san: played.san, uci: "e2e4" };
    const facts = buildCoachingFacts(e4Move, analysis);
    expect(facts.movedPieceAttacks).toEqual(["d5", "f5"]);
    expect(facts.supportsOwnKing).toBe(false);
    const errors = validateCoachOutput({
      moveId: "m1", verdict: "Good move", explanation: "The pawn on e4 protects squares around your king.",
      lesson: "Next time, ask what the pawn opens for your bishop.", evidenceIds: ["played_move", "piece_scope"],
    }, e4Move, analysis, facts, false);
    expect(errors.join(" ")).toMatch(/king-protection claim is false/);
  });

  it("rejects nonexistent pieces and false protection relationships", () => {
    const chess = new Chess(move.beforeFen);
    const played = chess.move({ from: "e2", to: "e4" });
    const e4Move: MoveRecord = { ...move, afterFen: chess.fen(), san: played.san, uci: "e2e4" };
    const facts = buildCoachingFacts(e4Move, analysis);
    const errors = validateCoachOutput({
      moveId: "m1", verdict: "Good move",
      explanation: "The pawn on e4 protects the f-pawn.",
      lesson: "Next time, ensure the knight on f3 is safe.", evidenceIds: ["played_move", "piece_scope"],
    }, e4Move, analysis, facts, false).join(" ");
    expect(errors).toMatch(/does not protect that f-pawn/);
    expect(errors).toMatch(/there is no knight on f3/);
    expect(errors).toMatch(/board coordinate or move notation/);
  });
});
