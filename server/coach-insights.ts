import type { AnalysisRecord, MoveRecord, OpeningMatch, Verdict } from "../shared/types.js";
import type { CoachingFacts } from "./coach-facts.js";

export type InsightKind =
  | "capture"
  | "loose-piece"
  | "outranked-piece"
  | "rescue"
  | "fork"
  | "line-motif"
  | "check"
  | "castling"
  | "development"
  | "central-pawn"
  | "new-attack"
  | "opening"
  | "engine-alternative"
  | "opponent-reply"
  | "missed-opportunity"
  | "ignored-threat"
  | "no-single-tactic"
  | "piece-scope";

export interface VerifiedInsight {
  id: string;
  kind: InsightKind;
  explanation: string;
  lesson: string;
  evidenceIds: string[];
  priority: number;
}

export interface CoachSelection {
  moveId: string;
  verdict: Verdict;
  insightId: string;
}

const EXPLAINS_A_BAD_MOVE = new Set<InsightKind>([
  "loose-piece",
  "outranked-piece",
  "opponent-reply",
  "engine-alternative",
  "missed-opportunity",
  "ignored-threat",
]);

const values: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

export function buildVerifiedInsights(
  move: MoveRecord,
  analysis: AnalysisRecord,
  facts: CoachingFacts,
  opening: OpeningMatch | undefined,
  hintsVisible: boolean,
): VerifiedInsight[] {
  const insights: VerifiedInsight[] = [];
  const unfavorable =
    analysis.verdict === "Blunder" || analysis.verdict === "Mistake" || analysis.verdict === "Inaccuracy";
  if (facts.capturedPiece) {
    const expensiveCapture = (values[facts.movingPiece] ?? 0) > (values[facts.capturedPiece] ?? 0);
    insights.push({
      id: "capture-result",
      kind: "capture",
      priority: unfavorable && expensiveCapture ? 100 : 62,
      explanation: `${move.san} used your ${facts.movingPiece} to capture a ${facts.capturedPiece} on ${facts.to}.${captureAftermath(facts, unfavorable, expensiveCapture)}`,
      lesson:
        !unfavorable && facts.movedPieceAttackers.length && !expensiveCapture
          ? `When you start a trade, check who recaptures and where their piece ends up.`
          : expensiveCapture
            ? `Before exchanging a ${facts.movingPiece} for a ${facts.capturedPiece}, check whether a forcing continuation wins enough material back.`
            : `After a capture, check whether the ${facts.movingPiece} is safe on ${facts.to}.`,
      evidenceIds: ["capture", "piece_scope"],
    });
  }
  // On a capture the aftermath is in the capture insight, and on a good move it's usually a trade, not a hanging piece.
  if (facts.movedPieceLoose && (unfavorable || !facts.capturedPiece))
    insights.push({
      id: "moved-piece-loose",
      kind: "loose-piece",
      priority: unfavorable ? 98 : 78,
      explanation: `After ${move.san}, your ${facts.movingPiece} on ${facts.to} can be captured and has no defender.`,
      lesson: `Before placing a ${facts.movingPiece} there, count what attacks and defends the square after the move.`,
      evidenceIds: ["piece_scope", "loose_pieces"],
    });
  const exposedOwn = facts.newlyLoosePieces.find((item) => item.color === facts.moverColor && item.square !== facts.to);
  if (exposedOwn)
    insights.push({
      id: "exposed-piece",
      kind: "loose-piece",
      priority: unfavorable ? 96 : 75,
      explanation: `${move.san} left your ${exposedOwn.piece} on ${exposedOwn.square} attacked with no defender.`,
      lesson: `Before moving the ${facts.movingPiece}, check which piece or line it stops defending.`,
      evidenceIds: ["played_move", "newly_loose"],
    });
  // Only for marked-down moves: on a good move the same geometry is usually a sound sacrifice.
  if (unfavorable && facts.movedPieceOutranked && !facts.movedPieceLoose)
    insights.push({
      id: "moved-piece-outranked",
      kind: "outranked-piece",
      priority: 97,
      explanation: `After ${move.san}, your ${facts.movingPiece} on ${facts.to} can be captured by the ${facts.movedPieceOutranked.piece} on ${facts.movedPieceOutranked.square}. Having a defender does not help, because you would still lose the ${facts.movingPiece} for a cheaper piece.`,
      lesson: `Before moving a ${facts.movingPiece}, check whether a cheaper enemy piece attacks the square, even if the square is defended.`,
      evidenceIds: ["piece_scope", "outranked"],
    });
  const outrankedOwn = facts.newlyOutranked[0];
  if (unfavorable && outrankedOwn)
    insights.push({
      id: "exposed-to-cheaper-piece",
      kind: "outranked-piece",
      priority: 95,
      explanation: `${move.san} left your ${outrankedOwn.piece} on ${outrankedOwn.square} attacked by the ${outrankedOwn.attacker} on ${outrankedOwn.attackerSquare}, a cheaper piece.`,
      lesson: `Before moving the ${facts.movingPiece}, check which enemy lines it was blocking and what stands behind it.`,
      evidenceIds: ["played_move", "outranked"],
    });
  const rescuedOwn = facts.rescuedPieces.find((item) => item.color === facts.moverColor);
  if (rescuedOwn)
    insights.push({
      id: "rescued-piece",
      kind: "rescue",
      priority: 80,
      explanation: `${move.san} removed the immediate loose-piece problem involving your ${rescuedOwn.piece}.`,
      lesson:
        "When a piece is attacked and undefended, compare moving it, defending it, and creating a stronger threat.",
      evidenceIds: ["played_move", "rescued"],
    });
  if (facts.gaveCheck)
    insights.push({
      id: "gave-check",
      kind: "check",
      priority: 76,
      explanation: `${move.san} gives check, so the opponent must answer the king threat immediately.`,
      lesson: "When you give check, look at every reply before assuming the attack continues.",
      evidenceIds: ["played_move", "check"],
    });
  if (facts.castled)
    insights.push({
      id: "castled",
      kind: "castling",
      priority: 74,
      explanation: `${move.san} castled your king and rook in one move.`,
      lesson:
        "After castling, check which central file your rook can use and whether the pawns around your king should stay put.",
      evidenceIds: ["played_move", "castling"],
    });
  if (facts.developedFromHome)
    insights.push({
      id: "developed-piece",
      kind: "development",
      priority: 68,
      explanation: `${move.san} developed your ${facts.movingPiece} from its starting square.`,
      lesson: `Now compare the useful squares the ${facts.movingPiece} reaches with any opponent threat that still needs an answer.`,
      evidenceIds: ["played_move", "development", "piece_scope"],
    });
  if (facts.centralPawnMove)
    insights.push({
      id: "central-pawn",
      kind: "central-pawn",
      priority: 64,
      explanation: `${move.san} advanced your ${facts.from[0]}-pawn into the center.`,
      lesson: `After this pawn move, check the two squares it attacks and which piece line opened behind ${facts.from}.`,
      evidenceIds: ["played_move", "central_pawn", "piece_scope"],
    });
  if (facts.newlyAttackedPieces.length) {
    const target = facts.newlyAttackedPieces.sort((a, b) => (values[b.piece] ?? 0) - (values[a.piece] ?? 0))[0];
    insights.push({
      id: "new-piece-attack",
      kind: "new-attack",
      priority: 72,
      explanation: `${move.san} puts your ${facts.movingPiece} in position to attack the ${target.piece} on ${target.square}.`,
      lesson: `Check whether that ${target.piece} can move, be defended, or answer with a stronger threat.`,
      evidenceIds: ["played_move", "new_attacks"],
    });
  }
  if (facts.forkTargets.length >= 2)
    insights.push({
      id: "piece-fork",
      kind: "fork",
      priority: 88,
      explanation: `${move.san} makes your ${facts.movingPiece} attack ${facts.forkTargets
        .slice(0, 2)
        .map((item) => `the ${item.piece} on ${item.square}`)
        .join(" and ")}.`,
      lesson:
        "For a fork to work, check whether either target can answer with check, capture the attacker, or save both pieces.",
      evidenceIds: ["played_move", "new_attacks"],
    });
  // An x-ray through to a pawn threatens nothing worth a coaching point.
  const motif =
    facts.lineMotifs.find((item) => item.type !== "x-ray") ??
    facts.lineMotifs.find((item) => item.behindPiece !== "pawn");
  // A piece that can be taken for free is not really pinning or skewering anything.
  if (motif && !facts.movedPieceLoose) {
    insights.push({
      id: "line-motif",
      kind: "line-motif",
      priority: motif.type === "pin" || motif.type === "skewer" ? 86 : 70,
      explanation: `${move.san} creates ${motif.type === "x-ray" ? "an x-ray" : `a ${motif.type}`}: the ${motif.frontPiece} on ${motif.frontSquare} stands in front of the ${motif.behindPiece} on ${motif.behindSquare}.`,
      lesson: `Check whether the ${motif.frontPiece} can move without exposing the piece behind it.`,
      evidenceIds: ["played_move", "line_motifs"],
    });
  }
  if (opening?.guidanceAvailable) {
    const plan = facts.moverColor === "w" ? opening.plansWhite : opening.plansBlack;
    insights.push({
      id: "opening-plan",
      kind: "opening",
      priority: 58,
      explanation: `${move.san} was played from a position identified as the ${opening.name}.`,
      lesson: `A useful plan in this opening is to ${plan.charAt(0).toLowerCase()}${plan.slice(1)}`,
      evidenceIds: ["played_move", "opening"],
    });
  }
  const missedMate = unfavorable ? missedMateInsight(move, analysis, facts, hintsVisible) : undefined;
  if (missedMate) insights.push(missedMate);
  const best = facts.bestAlternative;
  const missedCapture = Boolean(unfavorable && best?.capturedPiece);
  if (best?.capturedPiece && missedCapture) {
    const gain = best.materialWon
      ? `, which comes out about ${best.materialWon} ${best.materialWon === 1 ? "point" : "points"} of material ahead`
      : "";
    insights.push({
      id: "missed-capture",
      kind: "missed-opportunity",
      priority: 92,
      explanation: hintsVisible
        ? `The engine preferred ${best.san}, capturing the ${best.capturedPiece} on ${best.capturedSquare}${gain}.`
        : `A stronger capture was available than ${move.san}.`,
      lesson: "At the start of each turn, look at every capture you have, even the ones that look like plain trades.",
      evidenceIds: ["played_move", "best_alternative"],
    });
  }
  const ignored = facts.ignoredThreats[0];
  if (unfavorable && ignored)
    insights.push({
      id: "ignored-threat",
      kind: "ignored-threat",
      priority: 96,
      explanation: `${move.san} left your ${ignored.piece} on ${ignored.square} attacked with no defender, as it already was before the move.`,
      lesson: "Before choosing a move, check whether one of your pieces is already under attack.",
      evidenceIds: ["played_move", "ignored_threats"],
    });
  if (hintsVisible && unfavorable && !missedCapture && analysis.alternatives[0]?.san[0])
    insights.push({
      id: "engine-alternative",
      kind: "engine-alternative",
      priority: 90,
      explanation: `The engine preferred ${analysis.alternatives[0].san[0]} to ${move.san} here.`,
      lesson: `Use the review board to compare ${move.san} with ${analysis.alternatives[0].san[0]} and identify the first different threat.`,
      evidenceIds: ["played_move", "engine_verdict", "best_alternative"],
    });
  if (unfavorable) {
    const reply = opponentReplyInsight(move, analysis, facts, hintsVisible);
    if (reply) insights.push(reply);
  }
  if (unfavorable) {
    // A marked-down move needs a reason, so describing what it did, or praising it, doesn't belong on the card.
    const costlyCapture =
      (values[facts.movingPiece] ?? 0) > (values[facts.capturedPiece ?? ""] ?? 0) || facts.movedPieceLoose;
    const reasons = insights.filter(
      (item) => EXPLAINS_A_BAD_MOVE.has(item.kind) || (item.kind === "capture" && costlyCapture),
    );
    if (!reasons.length)
      reasons.push({
        id: "no-single-tactic",
        kind: "no-single-tactic",
        priority: 20,
        explanation: `The engine preferred another plan to ${move.san} here, and there's no single tactic behind it.`,
        lesson: "Use game review afterwards to compare this move with the engine's choice.",
        evidenceIds: ["played_move", "engine_verdict"],
      });
    return reasons.sort((a, b) => b.priority - a.priority);
  }
  insights.push({
    id: "piece-scope",
    kind: "piece-scope",
    priority: 10,
    explanation: `${move.san} holds the position. The engine found no real problem with it.`,
    lesson: facts.movedPieceAttacks.length
      ? `From ${facts.to}, check what changes on ${facts.movedPieceAttacks.slice(0, 3).join(", ")} before choosing your next plan.`
      : `Before the next move, check the opponent's checks, captures, and attacks on your ${facts.movingPiece}.`,
    evidenceIds: ["played_move", "piece_scope"],
  });
  return insights.sort((a, b) => b.priority - a.priority);
}

function missedMateInsight(
  move: MoveRecord,
  analysis: AnalysisRecord,
  facts: CoachingFacts,
  hintsVisible: boolean,
): VerifiedInsight | undefined {
  const sign = facts.moverColor === "w" ? 1 : -1;
  const hadMate = (analysis.beforeMate ?? 0) * sign;
  if (hadMate <= 0 || (analysis.afterMate ?? 0) * sign > 0) return undefined;
  return {
    id: "missed-mate",
    kind: "missed-opportunity",
    priority: 102,
    explanation:
      hintsVisible && facts.bestAlternative
        ? `The engine found a forced mate in ${hadMate}, starting with ${facts.bestAlternative.san}.`
        : `${move.san} missed a forced mate.`,
    lesson: "When the enemy king looks exposed, go through your checks before anything else.",
    evidenceIds: ["played_move", "engine_verdict"],
  };
}

function captureAftermath(facts: CoachingFacts, unfavorable: boolean, expensiveCapture: boolean): string {
  if (unfavorable)
    return facts.movedPieceLoose ? ` The ${facts.movingPiece} can now be captured and has no defender.` : "";
  if (!facts.movedPieceAttackers.length) return "";
  return expensiveCapture
    ? ` The ${facts.movingPiece} can be recaptured, but the engine still rates the move as sound.`
    : ` If your opponent recaptures, that's an even or better trade for you.`;
}

/** Says what the move allows. With hints hidden it stays vague, because the reply may be a live next move. */
function opponentReplyInsight(
  move: MoveRecord,
  analysis: AnalysisRecord,
  facts: CoachingFacts,
  hintsVisible: boolean,
): VerifiedInsight | undefined {
  const reply = facts.reply;
  if (!reply) return undefined;
  const evidenceIds = ["played_move", "reply"];
  const mateIn =
    analysis.afterMate === undefined ? undefined : analysis.afterMate * (facts.moverColor === "w" ? 1 : -1);
  if (mateIn !== undefined && mateIn < 0) {
    const distance = Math.abs(mateIn);
    return {
      id: "opponent-reply",
      kind: "opponent-reply",
      priority: 101,
      evidenceIds,
      explanation: !hintsVisible
        ? `${move.san} lets your opponent force checkmate.`
        : distance === 1
          ? `After ${move.san}, ${reply.san} is checkmate.`
          : `After ${move.san}, ${reply.san} starts a forced mate in ${distance}.`,
      lesson:
        "Before each move, look at every check your opponent would have next, starting with those near your king.",
    };
  }
  const lesson =
    "Before each move, go through the checks and captures your opponent would have next, and ask which one hurts most.";
  if (!hintsVisible) {
    if (!reply.materialLost) return undefined;
    return {
      id: "opponent-reply",
      kind: "opponent-reply",
      priority: 101,
      evidenceIds,
      lesson,
      explanation: `${move.san} gives your opponent a strong reply that wins material.`,
    };
  }
  if (reply.capturedPiece) {
    const gain = reply.materialLost
      ? ` Your opponent comes out about ${reply.materialLost} ${reply.materialLost === 1 ? "point" : "points"} of material ahead from here.`
      : "";
    return {
      id: "opponent-reply",
      kind: "opponent-reply",
      priority: 101,
      evidenceIds,
      lesson,
      explanation: `After ${move.san}, your opponent can answer ${reply.san}, capturing your ${reply.capturedPiece} on ${reply.capturedSquare}.${gain}`,
    };
  }
  // A quiet best reply can change with a longer search, so only name one that two searches agree on.
  if (!analysis.replyConfirmed) return undefined;
  return {
    id: "opponent-reply",
    kind: "opponent-reply",
    priority: 85,
    evidenceIds,
    lesson,
    explanation: `After ${move.san}, your opponent's strongest answer is ${reply.san}${reply.gaveCheck ? ", with check" : ""}.`,
  };
}

export function validateCoachSelection(
  selection: CoachSelection,
  move: MoveRecord,
  analysis: AnalysisRecord,
  insights: VerifiedInsight[],
): string[] {
  const errors: string[] = [];
  if (!selection || typeof selection !== "object") return ["response must be a selection object"];
  const unexpected = Object.keys(selection).filter((key) => !["moveId", "verdict", "insightId"].includes(key));
  if (unexpected.length) errors.push(`response contains unsupported fields: ${unexpected.join(", ")}`);
  if (selection.moveId !== move.id) errors.push("moveId does not match the reviewed move");
  if (selection.verdict !== analysis.verdict) errors.push("verdict does not match the verified engine verdict");
  if (!insights.some((insight) => insight.id === selection.insightId))
    errors.push("insightId is not one of the supplied verified insights");
  return errors;
}

export function renderCoachSelection(selection: CoachSelection, analysis: AnalysisRecord, insights: VerifiedInsight[]) {
  const insight = insights.find((item) => item.id === selection.insightId);
  if (!insight) throw new Error("Cannot render an unverified coaching insight.");
  return {
    moveId: selection.moveId,
    verdict: analysis.verdict,
    explanation: insight.explanation,
    lesson: insight.lesson,
    evidenceIds: insight.evidenceIds,
  };
}
