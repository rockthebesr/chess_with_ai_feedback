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
  return {
    id: "m",
    gameId: "g",
    branchId: "b",
    revision: 1,
    ply: 1,
    mover: played.color === "w" ? "white" : "black",
    beforeFen: fen,
    afterFen: chess.fen(),
    san: played.san,
    uci: `${from}${to}${promotion ?? ""}`,
    createdAt: "",
  };
}

function analysis(verdict: AnalysisRecord["verdict"] = "Good move"): AnalysisRecord {
  return {
    moveId: "m",
    status: "complete",
    verdict,
    budgetMs: 450,
    engine: "test",
    alternatives: [{ id: "v1", uci: ["g1f3"], san: ["Nf3"] }],
  };
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
    expect(buildCoachingFacts(attack, analysis()).newlyAttackedPieces).toContainEqual({
      square: "c6",
      piece: "knight",
    });
  });

  it("derives forks and line motifs instead of asking the model to invent them", () => {
    const fork = playedMove("4k3/8/3r3q/8/3N4/8/8/6K1 w - - 0 1", "d4", "f5");
    const forkFacts = buildCoachingFacts(fork, analysis());
    expect(forkFacts.newlyAttackedPieces).toEqual(
      expect.arrayContaining([
        { square: "d6", piece: "rook" },
        { square: "h6", piece: "queen" },
      ]),
    );
    expect(
      buildVerifiedInsights(fork, analysis(), forkFacts, undefined, false).some((item) => item.id === "piece-fork"),
    ).toBe(true);

    const pin = playedMove("8/3k4/2n5/8/8/8/4B3/6K1 w - - 0 1", "e2", "b5");
    const pinFacts = buildCoachingFacts(pin, analysis());
    expect(pinFacts.lineMotifs).toContainEqual({
      type: "pin",
      frontSquare: "c6",
      frontPiece: "knight",
      behindSquare: "d7",
      behindPiece: "king",
    });
    expect(
      buildVerifiedInsights(pin, analysis(), pinFacts, undefined, false).some((item) => item.id === "line-motif"),
    ).toBe(true);
  });

  describe("explaining a marked-down move", () => {
    // Bb2 from the reported game: it attacks e5 and develops the bishop, but neither is why it was marked down.
    const fen = "2rq1rk1/1p1n1ppp/2p5/2bnpN2/p7/1P1P2P1/P1P2PBP/R1B1QRK1 w - - 1 16";
    const insightsFor = (verdict: AnalysisRecord["verdict"], hintsVisible: boolean) => {
      const move = playedMove(fen, "c1", "b2");
      const result: AnalysisRecord = {
        ...analysis(verdict),
        alternatives: [{ id: "v1", uci: ["g2f3"], san: ["Bf3"] }],
      };
      return buildVerifiedInsights(move, result, buildCoachingFacts(move, result), undefined, hintsVisible);
    };

    it("says so honestly when no reason can be verified", () => {
      const [only, ...rest] = insightsFor("Inaccuracy", false);
      expect(rest).toEqual([]);
      expect(only.id).toBe("no-single-tactic");
      expect(only.explanation).toBe(
        "The engine preferred another plan to Bb2 here, and there's no single tactic behind it.",
      );
      expect(only.explanation).not.toContain("Bf3");
    });

    it("names the engine's choice only when hints are visible", () => {
      expect(insightsFor("Mistake", true).map((item) => item.explanation)).toEqual([
        "The engine preferred Bf3 to Bb2 here.",
      ]);
    });

    it("never offers narration or praise for a bad move", () => {
      for (const verdict of ["Inaccuracy", "Mistake", "Blunder"] as const) {
        const kinds = insightsFor(verdict, true).map((item) => item.kind);
        expect(kinds).not.toEqual(expect.arrayContaining(["new-attack"]));
        expect(kinds).not.toEqual(expect.arrayContaining(["development"]));
        expect(kinds).not.toEqual(expect.arrayContaining(["piece-scope"]));
      }
    });

    it("keeps describing good moves", () => {
      expect(insightsFor("Good move", false).map((item) => item.id)).toEqual(
        expect.arrayContaining(["new-piece-attack", "developed-piece", "piece-scope"]),
      );
    });

    it("falls back to the same honest text when coaching is offline", () => {
      const move = playedMove(fen, "c1", "b2");
      expect(fallbackCoaching(move, analysis("Inaccuracy")).explanation).toContain("no single tactic");
    });
  });

  describe("what the player missed", () => {
    const withBest = (
      fen: string,
      from: string,
      to: string,
      best: string[],
      hintsVisible: boolean,
      extra: Partial<AnalysisRecord> = {},
    ) => {
      const move = playedMove(fen, from, to);
      const result: AnalysisRecord = {
        ...analysis("Inaccuracy"),
        alternatives: [{ id: "v1", uci: best, san: [] }],
        ...extra,
      };
      return buildVerifiedInsights(move, result, buildCoachingFacts(move, result), undefined, hintsVisible);
    };
    const reported = "2rq1rk1/1p1n1ppp/2p5/2bnpN2/p7/1P1P2P1/P1P2PBP/R1B1QRK1 w - - 1 16";

    it("names the capture the engine preferred when hints are visible, without inventing a material gain", () => {
      const [top] = withBest(reported, "c1", "b2", ["b3a4", "c8a8", "a1b1", "a8a4"], true);
      expect(top.explanation).toBe("The engine preferred bxa4, capturing the pawn on a4.");
    });

    it("hides the capture when hints are hidden", () => {
      const [top] = withBest(reported, "c1", "b2", ["b3a4"], false);
      expect(top.explanation).toBe("A stronger capture was available than Bb2.");
      expect(top.explanation).not.toMatch(/a4/);
    });

    it("counts material once the line settles", () => {
      const [top] = withBest("4k3/8/8/3p4/4P3/5P2/7P/4K3 w - - 0 1", "h2", "h3", ["e4d5", "e8e7"], true);
      expect(top.explanation).toBe(
        "The engine preferred exd5, capturing the pawn on d5, which comes out about 1 point of material ahead.",
      );
    });

    it("does not call the played move a missed capture", () => {
      const insights = withBest("4k3/8/8/3p4/4P3/8/7P/4K3 w - - 0 1", "e4", "d5", ["e4d5"], true);
      expect(insights.some((item) => item.id === "missed-capture")).toBe(false);
    });

    it("flags a piece that was already hanging and still is", () => {
      const insights = withBest("4kb2/8/8/8/8/N7/7P/4K3 w - - 0 1", "h2", "h3", ["a3b5"], false);
      expect(insights[0].explanation).toBe(
        "h3 left your knight on a3 attacked with no defender, as it already was before the move.",
      );
    });

    it("does not call a piece that moved away ignored", () => {
      const insights = withBest("4kb2/8/8/8/8/N7/7P/4K3 w - - 0 1", "a3", "b1", ["a3b5"], false);
      expect(insights.some((item) => item.id === "ignored-threat")).toBe(false);
    });

    it("calls out a missed forced mate, naming it only when hints are visible", () => {
      const mate = { beforeMate: 2, afterCp: 300 };
      const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
      expect(withBest(fen, "h2", "h3", ["a1a8"], true, mate)[0].explanation).toBe(
        "The engine found a forced mate in 2, starting with Ra8#.",
      );
      expect(withBest(fen, "h2", "h3", ["a1a8"], false, mate)[0].explanation).toBe("h3 missed a forced mate.");
      expect(
        withBest(fen, "h2", "h3", ["a1a8"], true, { beforeMate: 2, afterMate: 1 }).some(
          (item) => item.id === "missed-mate",
        ),
      ).toBe(false);
    });
  });

  describe("attacks by cheaper pieces", () => {
    const insightsFor = (fen: string, from: string, to: string, verdict: AnalysisRecord["verdict"] = "Blunder") => {
      const move = playedMove(fen, from, to);
      const result = analysis(verdict);
      const facts = buildCoachingFacts(move, result);
      return { facts, insights: buildVerifiedInsights(move, result, facts, undefined, false) };
    };

    it("flags a defended queen moved to a square a pawn attacks", () => {
      const { facts, insights } = insightsFor("4k3/8/4p3/8/8/8/3Q4/3RK3 w - - 0 1", "d2", "d5");
      expect(facts.movedPieceDefenders).toContain("d1");
      expect(facts.movedPieceLoose).toBe(false);
      expect(facts.movedPieceOutranked).toEqual({ square: "e6", piece: "pawn" });
      expect(insights.find((item) => item.id === "moved-piece-outranked")?.explanation).toContain(
        "captured by the pawn on e6",
      );
    });

    it("does not flag an even trade or a good move", () => {
      expect(insightsFor("4k3/8/4p3/3r4/8/8/8/3RK3 w - - 0 1", "d1", "d5").facts.movedPieceOutranked).toBeUndefined();
      const sacrifice = insightsFor("4k3/8/4p3/8/8/8/3Q4/3RK3 w - - 0 1", "d2", "d5", "Good move");
      expect(sacrifice.insights.some((item) => item.id === "moved-piece-outranked")).toBe(false);
    });

    it("flags a defended piece uncovered to a cheaper attacker", () => {
      const { facts, insights } = insightsFor("4k3/6b1/8/8/8/8/1N6/R2QK3 w - - 0 1", "b2", "d3");
      expect(facts.newlyOutranked).toEqual([{ square: "a1", piece: "rook", attackerSquare: "g7", attacker: "bishop" }]);
      expect(insights.some((item) => item.id === "exposed-to-cheaper-piece")).toBe(true);
    });

    it("does not repeat a threat that existed before the move", () => {
      const { facts } = insightsFor("4k3/6b1/8/8/8/8/8/R2QK2N w - - 0 1", "h1", "g3");
      expect(facts.newlyOutranked).toEqual([]);
    });
  });

  describe("what the move allows", () => {
    const fen = "4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1";
    const bad = (uci: string[], extra: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
      ...analysis("Blunder"),
      continuation: { id: "reply", uci, san: [] },
      ...extra,
    });
    const replyInsight = (result: AnalysisRecord, hintsVisible: boolean, position = fen, from = "c3", to = "e4") => {
      const move = playedMove(position, from, to);
      return buildVerifiedInsights(move, result, buildCoachingFacts(move, result), undefined, hintsVisible);
    };

    it("names the punishing capture and leads with it when hints are visible", () => {
      const [top] = replyInsight(bad(["d5e4", "e1e2"]), true);
      expect(top.id).toBe("opponent-reply");
      expect(top.explanation).toBe(
        "After Ne4, your opponent can answer dxe4, capturing your knight on e4. Your opponent comes out about 3 points of material ahead from here.",
      );
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

  describe("real forks and pins", () => {
    const facts = (fen: string, from: string, to: string) => buildCoachingFacts(playedMove(fen, from, to), analysis());
    const hasFork = (fen: string, from: string, to: string) => {
      const move = playedMove(fen, from, to);
      return buildVerifiedInsights(move, analysis(), buildCoachingFacts(move, analysis()), undefined, false).some(
        (item) => item.id === "piece-fork",
      );
    };

    it("does not call attacking two defended pawns a fork", () => {
      expect(hasFork("4k3/1p3p2/2p1p3/8/8/8/8/3QK3 w - - 0 1", "d1", "d7")).toBe(false);
    });

    it("counts the king, undefended pieces, and pieces worth more than the attacker", () => {
      expect(hasFork("8/4k3/8/8/3N4/8/1r6/4K3 w - - 0 1", "d4", "c6")).toBe(false);
      expect(facts("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5", "c7").forkTargets).toEqual(
        expect.arrayContaining([
          { square: "e8", piece: "king" },
          { square: "a8", piece: "rook" },
        ]),
      );
      expect(hasFork("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5", "c7")).toBe(true);
    });

    it("does not call it a fork when the forking piece can be taken", () => {
      expect(hasFork("4k3/1r2p3/8/1N6/8/8/8/4K3 w - - 0 1", "b5", "d6")).toBe(false);
    });

    it("recognizes a pin against a queen as well as a king", () => {
      expect(facts("q3k3/1n6/8/8/8/8/6B1/4K3 w - - 0 1", "g2", "d5").lineMotifs).toContainEqual({
        type: "pin",
        frontSquare: "b7",
        frontPiece: "knight",
        behindSquare: "a8",
        behindPiece: "queen",
      });
    });

    it("recognizes a skewer through a more valuable piece", () => {
      expect(facts("n7/1r2k3/8/8/8/8/6B1/4K3 w - - 0 1", "g2", "d5").lineMotifs).toContainEqual({
        type: "skewer",
        frontSquare: "b7",
        frontPiece: "rook",
        behindSquare: "a8",
        behindPiece: "knight",
      });
    });

    it("does not call it a pin when the front piece can take the attacker", () => {
      const motifs = facts("4r1k1/8/8/8/8/8/8/1Q2K3 w - - 0 1", "b1", "e4").lineMotifs;
      expect(motifs.filter((item) => item.type === "pin")).toEqual([]);
    });

    it("words an x-ray correctly", () => {
      const move = playedMove("6k1/p7/1p6/8/8/8/8/4K1B1 w - - 0 1", "g1", "e3");
      const insight = buildVerifiedInsights(
        move,
        analysis(),
        buildCoachingFacts(move, analysis()),
        undefined,
        false,
      ).find((item) => item.id === "line-motif");
      expect(insight?.explanation).toContain("an x-ray");
    });
  });

  it("accepts only a supplied insight and verified verdict", () => {
    const move = playedMove(new Chess().fen(), "e2", "e4");
    const result = analysis();
    const facts = buildCoachingFacts(move, result);
    const insights = buildVerifiedInsights(move, result, facts, undefined, false);
    expect(
      validateCoachSelection({ moveId: "m", verdict: "Mistake", insightId: "invented" }, move, result, insights).join(
        " ",
      ),
    ).toMatch(/verdict.*insightId/);
    const selection = { moveId: "m", verdict: result.verdict, insightId: "central-pawn" } as const;
    expect(validateCoachSelection(selection, move, result, insights)).toEqual([]);
    expect(renderCoachSelection(selection, result, insights).explanation).toBe(
      insights.find((item) => item.id === "central-pawn")?.explanation,
    );
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
    expect(
      buildVerifiedInsights(move, result, facts, unsupported, false).some((item) => item.id === "opening-plan"),
    ).toBe(false);
    const london = recognizeOpening(["d4", "d5", "Nf3", "Nf6", "Bf4"]);
    expect(london?.guidanceAvailable).toBe(true);
    expect(buildVerifiedInsights(move, result, facts, london, false).some((item) => item.id === "opening-plan")).toBe(
      true,
    );
  });
});
