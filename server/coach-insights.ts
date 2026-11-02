import type { AnalysisRecord, MoveRecord, OpeningMatch, Verdict } from "../shared/types.js";
import type { CoachingFacts } from "./coach-facts.js";

export type InsightKind = "capture" | "loose-piece" | "rescue" | "fork" | "line-motif" | "check" | "castling" | "development" | "central-pawn" | "new-attack" | "opening" | "engine-alternative" | "piece-scope";

export interface VerifiedInsight {
  id: string;
  kind: InsightKind;
  explanation: string;
  lesson: string;
  evidenceIds: string[];
  priority: number;
}

export interface CoachSelection { moveId: string; verdict: Verdict; insightId: string }

const values: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

export function buildVerifiedInsights(move: MoveRecord, analysis: AnalysisRecord, facts: CoachingFacts, opening: OpeningMatch | undefined, hintsVisible: boolean): VerifiedInsight[] {
  const insights: VerifiedInsight[] = [];
  const unfavorable = analysis.verdict === "Blunder" || analysis.verdict === "Mistake" || analysis.verdict === "Inaccuracy";
  if (facts.capturedPiece) {
    const expensiveCapture = (values[facts.movingPiece] ?? 0) > (values[facts.capturedPiece] ?? 0);
    insights.push({ id: "capture-result", kind: "capture", priority: unfavorable && expensiveCapture ? 100 : 62,
      explanation: `${move.san} used your ${facts.movingPiece} to capture a ${facts.capturedPiece} on ${facts.to}.${facts.movedPieceLoose ? ` The ${facts.movingPiece} can now be captured and has no legal defender.` : ""}`,
      lesson: expensiveCapture ? `Before exchanging a ${facts.movingPiece} for a ${facts.capturedPiece}, check whether a forcing continuation wins enough material back.` : `After a capture, check whether the ${facts.movingPiece} is safe on ${facts.to}.`,
      evidenceIds: ["capture", "piece_scope"] });
  }
  if (facts.movedPieceLoose) insights.push({ id: "moved-piece-loose", kind: "loose-piece", priority: unfavorable ? 98 : 78,
    explanation: `After ${move.san}, your ${facts.movingPiece} on ${facts.to} can be captured and has no legal defender.`,
    lesson: `Before placing a ${facts.movingPiece} there, count its legal attackers and defenders after the move.`, evidenceIds: ["piece_scope", "loose_pieces"] });
  const exposedOwn = facts.newlyLoosePieces.find((item) => item.color === facts.moverColor && item.square !== facts.to);
  if (exposedOwn) insights.push({ id: "exposed-piece", kind: "loose-piece", priority: unfavorable ? 96 : 75,
    explanation: `${move.san} left your ${exposedOwn.piece} on ${exposedOwn.square} attacked with no legal defender.`,
    lesson: `Before moving the ${facts.movingPiece}, check which piece or line it stops defending.`, evidenceIds: ["played_move", "newly_loose"] });
  const rescuedOwn = facts.rescuedPieces.find((item) => item.color === facts.moverColor);
  if (rescuedOwn) insights.push({ id: "rescued-piece", kind: "rescue", priority: 80,
    explanation: `${move.san} removed the immediate loose-piece problem involving your ${rescuedOwn.piece}.`,
    lesson: "When a piece is attacked and undefended, compare moving it, defending it, and creating a stronger threat.", evidenceIds: ["played_move", "rescued"] });
  if (facts.gaveCheck) insights.push({ id: "gave-check", kind: "check", priority: 76,
    explanation: `${move.san} gives check, so the opponent must answer the king threat immediately.`,
    lesson: "When you give check, look at every legal reply before assuming the attack continues.", evidenceIds: ["played_move", "check"] });
  if (facts.castled) insights.push({ id: "castled", kind: "castling", priority: 74,
    explanation: `${move.san} castled your king and rook in one move.`,
    lesson: "After castling, check which central file your rook can use and whether the pawns around your king should stay put.", evidenceIds: ["played_move", "castling"] });
  if (facts.developedFromHome) insights.push({ id: "developed-piece", kind: "development", priority: 68,
    explanation: `${move.san} developed your ${facts.movingPiece} from its starting square.`,
    lesson: `Now compare the useful squares the ${facts.movingPiece} reaches with any opponent threat that still needs an answer.`, evidenceIds: ["played_move", "development", "piece_scope"] });
  if (facts.centralPawnMove) insights.push({ id: "central-pawn", kind: "central-pawn", priority: 64,
    explanation: `${move.san} advanced your ${facts.from[0]}-pawn into the center.`,
    lesson: `After this pawn move, check the two squares it attacks and which piece line opened behind ${facts.from}.`, evidenceIds: ["played_move", "central_pawn", "piece_scope"] });
  if (facts.newlyAttackedPieces.length) {
    const target = facts.newlyAttackedPieces.sort((a, b) => (values[b.piece] ?? 0) - (values[a.piece] ?? 0))[0];
    insights.push({ id: "new-piece-attack", kind: "new-attack", priority: 72,
      explanation: `${move.san} places your ${facts.movingPiece} where it can legally capture the ${target.piece} on ${target.square}.`,
      lesson: `Check whether that ${target.piece} can move, be defended, or answer with a stronger threat.`, evidenceIds: ["played_move", "new_attacks"] });
  }
  if (facts.newlyAttackedPieces.length >= 2) insights.push({ id: "piece-fork", kind: "fork", priority: 88,
    explanation: `${move.san} makes your ${facts.movingPiece} attack ${facts.newlyAttackedPieces.slice(0, 2).map((item) => `the ${item.piece} on ${item.square}`).join(" and ")}.`,
    lesson: "For a fork to work, check whether either target can answer with check, capture the attacker, or save both pieces.", evidenceIds: ["played_move", "new_attacks"] });
  if (facts.lineMotifs.length) {
    const motif = facts.lineMotifs[0];
    insights.push({ id: "line-motif", kind: "line-motif", priority: motif.type === "pin" || motif.type === "skewer" ? 86 : 70,
      explanation: `${move.san} creates a ${motif.type}: the ${motif.frontPiece} on ${motif.frontSquare} stands in front of the ${motif.behindPiece} on ${motif.behindSquare}.`,
      lesson: `Check whether the ${motif.frontPiece} can move without exposing the piece behind it.`, evidenceIds: ["played_move", "line_motifs"] });
  }
  if (opening?.guidanceAvailable) {
    const plan = facts.moverColor === "w" ? opening.plansWhite : opening.plansBlack;
    insights.push({ id: "opening-plan", kind: "opening", priority: 58,
      explanation: `${move.san} was played from a position identified as the ${opening.name}.`,
      lesson: `A useful plan in this opening is to ${plan.charAt(0).toLowerCase()}${plan.slice(1)}`,
      evidenceIds: ["played_move", "opening"] });
  }
  if (hintsVisible && unfavorable && analysis.alternatives[0]?.san[0]) insights.push({ id: "engine-alternative", kind: "engine-alternative", priority: 90,
    explanation: `${move.san} received a ${analysis.verdict.toLowerCase()} verdict; the verified alternative was ${analysis.alternatives[0].san[0]}.`,
    lesson: `Use the review board to compare ${move.san} with ${analysis.alternatives[0].san[0]} and identify the first different threat.`, evidenceIds: ["played_move", "engine_verdict", "best_alternative"] });
  insights.push({ id: "piece-scope", kind: "piece-scope", priority: 10,
    explanation: `${move.san} moved your ${facts.movingPiece} from ${facts.from} to ${facts.to}.`,
    lesson: facts.movedPieceAttacks.length
      ? `From ${facts.to}, check what changes on ${facts.movedPieceAttacks.slice(0, 3).join(", ")} before choosing your next plan.`
      : `Before the next move, check the opponent's checks, captures, and attacks on your ${facts.movingPiece}.`, evidenceIds: ["played_move", "piece_scope"] });
  return insights.sort((a, b) => b.priority - a.priority);
}

export function validateCoachSelection(selection: CoachSelection, move: MoveRecord, analysis: AnalysisRecord, insights: VerifiedInsight[]): string[] {
  const errors: string[] = [];
  if (!selection || typeof selection !== "object") return ["response must be a selection object"];
  const unexpected = Object.keys(selection).filter((key) => !["moveId", "verdict", "insightId"].includes(key));
  if (unexpected.length) errors.push(`response contains unsupported fields: ${unexpected.join(", ")}`);
  if (selection.moveId !== move.id) errors.push("moveId does not match the reviewed move");
  if (selection.verdict !== analysis.verdict) errors.push("verdict does not match the verified engine verdict");
  if (!insights.some((insight) => insight.id === selection.insightId)) errors.push("insightId is not one of the supplied verified insights");
  return errors;
}

export function renderCoachSelection(selection: CoachSelection, analysis: AnalysisRecord, insights: VerifiedInsight[]) {
  const insight = insights.find((item) => item.id === selection.insightId);
  if (!insight) throw new Error("Cannot render an unverified coaching insight.");
  return { moveId: selection.moveId, verdict: analysis.verdict, explanation: insight.explanation, lesson: insight.lesson, evidenceIds: insight.evidenceIds };
}
