import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { fallbackCoaching } from "../server/coach.js";
import { buildCoachingFacts } from "../server/coach-facts.js";
import { buildVerifiedInsights, renderCoachSelection, validateCoachSelection } from "../server/coach-insights.js";
import { recognizeOpening } from "../server/openings.js";
import type { AnalysisRecord, MoveRecord } from "../shared/types.js";

function playedMove(fen: string, from: string, to: string, promotion?: string): MoveRecord {
  const chess = new Chess(fen);
  const played = chess.move({ from, to, promotion });
  return { id: "m", gameId: "g", branchId: "b", revision: 1, ply: 1, mover: played.color === "w" ? "white" : "black", beforeFen: fen, afterFen: chess.fen(), san: played.san, uci: `${from}${to}${promotion ?? ""}`, createdAt: "" };
}

function analysis(verdict: AnalysisRecord["verdict"] = "Good move"): AnalysisRecord {
  return { moveId: "m", status: "complete", verdict, budgetMs: 450, engine: "test", alternatives: [{ id: "v1", uci: ["g1f3"], san: ["Nf3"] }] };
}

describe("verified coaching insights", () => {
  it("turns a central pawn move into server-authored coaching", () => {
    const move = playedMove(new Chess().fen(), "e2", "e4");
    const facts = buildCoachingFacts(move, analysis());
    const insights = buildVerifiedInsights(move, analysis(), facts, undefined, false);
    expect(facts.centralPawnMove).toBe(true);
    expect(facts.movedPieceAttacks).toEqual(["d5", "f5"]);
    expect(insights.find((item) => item.id === "central-pawn")?.lesson).toContain("two squares");
  });

  it("detects an attacked, legally undefended capturing piece", () => {
    const move = playedMove("r3k3/8/8/8/8/8/p7/R5K1 w - - 0 1", "a1", "a2");
    const result = analysis("Mistake");
    const facts = buildCoachingFacts(move, result);
    const insights = buildVerifiedInsights(move, result, facts, undefined, false);
    expect(facts.capturedPiece).toBe("pawn");
    expect(facts.movedPieceAttackers).toContain("a8");
    expect(facts.movedPieceDefenders).toEqual([]);
    expect(facts.movedPieceLoose).toBe(true);
    expect(facts.materialSwing).toBe(1);
    expect(insights[0].id).toBe("capture-result");
    expect(insights.some((item) => item.id === "moved-piece-loose")).toBe(true);
  });

  it("does not call a piece loose when a legal defender exists", () => {
    const move = playedMove("r3k3/8/8/8/8/8/pR6/R5K1 w - - 0 1", "a1", "a2");
    const facts = buildCoachingFacts(move, analysis("Mistake"));
    expect(facts.movedPieceAttackers).toContain("a8");
    expect(facts.movedPieceDefenders).toContain("b2");
    expect(facts.movedPieceLoose).toBe(false);
  });

  it("recognizes development, castling, and a newly attacked enemy piece", () => {
    const developed = playedMove(new Chess().fen(), "g1", "f3");
    expect(buildCoachingFacts(developed, analysis()).developedFromHome).toBe(true);

    const castled = playedMove("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "g1");
    expect(buildCoachingFacts(castled, analysis()).castled).toBe(true);

    const chess = new Chess();
    for (const san of ["e4", "e5", "Nf3", "Nc6"]) chess.move(san);
    const attack = playedMove(chess.fen(), "f1", "b5");
    expect(buildCoachingFacts(attack, analysis()).newlyAttackedPieces).toContainEqual({ square: "c6", piece: "knight" });
  });

  it("derives forks and line motifs instead of asking the model to invent them", () => {
    const fork = playedMove("4k3/8/3r3q/8/3N4/8/8/6K1 w - - 0 1", "d4", "f5");
    const forkFacts = buildCoachingFacts(fork, analysis());
    expect(forkFacts.newlyAttackedPieces).toEqual(expect.arrayContaining([{ square: "d6", piece: "rook" }, { square: "h6", piece: "queen" }]));
    expect(buildVerifiedInsights(fork, analysis(), forkFacts, undefined, false).some((item) => item.id === "piece-fork")).toBe(true);

    const pin = playedMove("8/3k4/2n5/8/8/8/4B3/6K1 w - - 0 1", "e2", "b5");
    const pinFacts = buildCoachingFacts(pin, analysis());
    expect(pinFacts.lineMotifs).toContainEqual({ type: "pin", frontSquare: "c6", frontPiece: "knight", behindSquare: "d7", behindPiece: "king" });
    expect(buildVerifiedInsights(pin, analysis(), pinFacts, undefined, false).some((item) => item.id === "line-motif")).toBe(true);
  });

  describe("what the move allows", () => {
    const fen = "4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1";
    const bad = (uci: string[], extra: Partial<AnalysisRecord> = {}): AnalysisRecord => ({ ...analysis("Blunder"), continuation: { id: "reply", uci, san: [] }, ...extra });
    const replyInsight = (result: AnalysisRecord, hintsVisible: boolean, position = fen, from = "c3", to = "e4") => {
      const move = playedMove(position, from, to);
      return buildVerifiedInsights(move, result, buildCoachingFacts(move, result), undefined, hintsVisible);
    };

    it("names the punishing capture and leads with it when hints are visible", () => {
      const [top] = replyInsight(bad(["d5e4", "e1e2"]), true);
      expect(top.id).toBe("opponent-reply");
      expect(top.explanation).toBe("After Ne4, your opponent can answer dxe4, capturing your knight on e4. Your opponent comes out about 3 points of material ahead from here.");
    });

    it("does not count material while an exchange is unfinished", () => {
      const facts = buildCoachingFacts(playedMove(fen, "c3", "e4"), bad(["d5e4"]));
      expect(facts.reply).toMatchObject({ san: "dxe4", capturedPiece: "knight", materialLost: 0 });
    });

    it("never names the reply or the piece when hints are hidden", () => {
      const [top] = replyInsight(bad(["d5e4", "e1e2"]), false);
      expect(top.explanation).toBe("Ne4 gives your opponent a strong reply that wins material.");
      expect(`${top.explanation} ${top.lesson}`).not.toMatch(/dxe4|knight/);
      expect(replyInsight(bad(["d5e4"]), false).some((item) => item.id === "opponent-reply")).toBe(false);
    });

    it("explains an allowed mate with or without hints", () => {
      const mate = bad(["d5e4"], { afterMate: -2 });
      expect(replyInsight(mate, true)[0].explanation).toBe("After Ne4, dxe4 starts a forced mate in 2.");
      expect(replyInsight(mate, false)[0].explanation).toBe("Ne4 lets your opponent force checkmate.");
    });

    it("stays quiet for good moves and when no reply was found", () => {
      const good = { ...bad(["d5e4", "e1e2"]), verdict: "Good move" as const };
      expect(replyInsight(good, true).some((item) => item.id === "opponent-reply")).toBe(false);
      expect(replyInsight(analysis("Blunder"), true).some((item) => item.id === "opponent-reply")).toBe(false);
    });

    it("gives the same explanation when coaching is offline, respecting hidden hints", () => {
      const move = playedMove(fen, "c3", "e4");
      const result = bad(["d5e4", "e1e2"]);
      expect(fallbackCoaching(move, result, undefined, true).explanation).toContain("dxe4");
      const hidden = fallbackCoaching(move, result);
      expect(hidden.explanation).toBe("Ne4 gives your opponent a strong reply that wins material.");
      expect(hidden.status).toBe("verified-fallback");
    });
  });

  it("accepts only a supplied insight and verified verdict", () => {
    const move = playedMove(new Chess().fen(), "e2", "e4");
    const result = analysis();
    const facts = buildCoachingFacts(move, result);
    const insights = buildVerifiedInsights(move, result, facts, undefined, false);
    expect(validateCoachSelection({ moveId: "m", verdict: "Mistake", insightId: "invented" }, move, result, insights).join(" ")).toMatch(/verdict.*insightId/);
    const selection = { moveId: "m", verdict: result.verdict, insightId: "central-pawn" } as const;
    expect(validateCoachSelection(selection, move, result, insights)).toEqual([]);
    expect(renderCoachSelection(selection, result, insights).explanation).toBe(insights.find((item) => item.id === "central-pawn")?.explanation);
    const injected = { ...selection, explanation: "Your queen disappeared." };
    expect(validateCoachSelection(injected, move, result, insights).join(" ")).toContain("unsupported fields");
    expect(() => renderCoachSelection({ ...selection, insightId: "invented" }, result, insights)).toThrow(/unverified/);
  });

  it("offers an opening insight only when specific guidance is stored", () => {
    const move = playedMove(new Chess().fen(), "e2", "e4");
    const result = analysis();
    const facts = buildCoachingFacts(move, result);
    const unsupported = recognizeOpening(["e4", "e5", "Nf3", "Nc6", "Bc4"]);
    expect(unsupported?.guidanceAvailable).toBe(false);
    expect(buildVerifiedInsights(move, result, facts, unsupported, false).some((item) => item.id === "opening-plan")).toBe(false);
    const london = recognizeOpening(["d4", "d5", "Nf3", "Nf6", "Bf4"]);
    expect(london?.guidanceAvailable).toBe(true);
    expect(buildVerifiedInsights(move, result, facts, london, false).some((item) => item.id === "opening-plan")).toBe(true);
  });
});
