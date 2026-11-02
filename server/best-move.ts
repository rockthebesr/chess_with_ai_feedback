import { Chess } from "chess.js";
import type { AnalysisRecord, BestMoveAdvice, MoveRecord } from "../shared/types.js";
import { buildCoachingFacts, replayLine } from "./coach-facts.js";
import type { UciEngine, UciLine } from "./uci.js";

const SEARCH_MS = 1500;
const MAX_REASONS = 3;
const LEVEL_CP = 30;
const CLOSE_CP = 20;

const pawns = (cp: number) => (Math.abs(cp) / 100).toFixed(1);
const points = (count: number) => `${count} ${count === 1 ? "point" : "points"}`;

/** Asks the engine for the best move and explains it from board checks. The model never writes any of this text. */
export async function findBestMove(engine: UciEngine, fen: string): Promise<BestMoveAdvice | undefined> {
  const { lines } = await engine.analyze(fen, SEARCH_MS, 2);
  const best = lines[0];
  const uci = best?.moves[0];
  if (!uci) return undefined;
  const position = new Chess(fen);
  const mover = position.turn();
  let san: string;
  try {
    san = position.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return undefined;
  }
  const line = sanLine(fen, best.moves);
  return {
    fen,
    san,
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    reasons: reasonsFor(fen, position.fen(), san, uci, best, mover),
    evaluation: evaluationText(best),
    line,
    comparison: comparisonText(fen, best, lines[1]),
  };
}

function sanLine(fen: string, moves: string[]): string[] {
  const board = new Chess(fen);
  const line: string[] = [];
  for (const uci of moves.slice(0, 6)) {
    try {
      line.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return line;
}

function reasonsFor(
  beforeFen: string,
  afterFen: string,
  san: string,
  uci: string,
  best: UciLine,
  mover: "w" | "b",
): string[] {
  const move: MoveRecord = {
    id: "best-move",
    gameId: "",
    branchId: "",
    revision: 0,
    ply: 0,
    mover: mover === "w" ? "white" : "black",
    beforeFen,
    afterFen,
    san,
    uci,
    createdAt: "",
  };
  const analysis: AnalysisRecord = {
    moveId: move.id,
    status: "complete",
    verdict: "Good move",
    budgetMs: SEARCH_MS,
    engine: "",
    alternatives: [],
    continuation: { id: "reply", uci: best.moves.slice(1, 7), san: [] },
  };
  const facts = buildCoachingFacts(move, analysis);
  const reasons: string[] = [];
  if (best.mate !== undefined && best.mate > 0)
    reasons.push(best.mate === 1 ? "It's checkmate." : `It starts a forced mate in ${best.mate}.`);
  if (best.mate !== undefined && best.mate < 0)
    reasons.push("Every move loses to a forced mate, but this one holds out the longest.");
  const won = replayLine(beforeFen, best.moves.slice(0, 7), mover)?.materialChange ?? 0;
  if (facts.capturedPiece)
    reasons.push(
      `It captures the ${facts.capturedPiece} on ${facts.to}${won > 0 ? `, and you come out about ${points(won)} of material ahead` : ""}.`,
    );
  else if (won > 0) reasons.push(`It wins about ${points(won)} of material over the next few moves.`);
  const rescued = facts.rescuedPieces.find((item) => item.color === mover);
  if (rescued)
    reasons.push(
      `It deals with the threat to your ${rescued.piece} on ${rescued.square}, which was attacked with no defender.`,
    );
  if (facts.forkTargets.length >= 2)
    reasons.push(
      `It attacks ${facts.forkTargets
        .slice(0, 2)
        .map((item) => `the ${item.piece} on ${item.square}`)
        .join(" and ")} at once.`,
    );
  const motif = facts.lineMotifs.find((item) => item.type !== "x-ray");
  if (motif)
    reasons.push(
      motif.type === "pin"
        ? `It pins the ${motif.frontPiece} on ${motif.frontSquare} against the ${motif.behindPiece} on ${motif.behindSquare}.`
        : `It skewers the ${motif.frontPiece} on ${motif.frontSquare}, with the ${motif.behindPiece} on ${motif.behindSquare} behind it.`,
    );
  if (facts.gaveCheck && !san.includes("#")) reasons.push("It gives check, so your opponent has to respond.");
  if (facts.castled) reasons.push("It castles, moving your king off the center file and bringing a rook into play.");
  if (facts.developedFromHome)
    reasons.push(`It brings your ${facts.movingPiece} into the game from its starting square.`);
  if (facts.centralPawnMove) reasons.push(`It advances your ${facts.from[0]}-pawn in the center.`);
  if (!reasons.length)
    reasons.push("There's no single tactic behind it. The engine simply rates the resulting position highest.");
  return reasons.slice(0, MAX_REASONS);
}

function evaluationText(best: UciLine): string {
  if (best.mate !== undefined) return best.mate > 0 ? "You have a forced mate." : "Your opponent has a forced mate.";
  const cp = best.cp ?? 0;
  if (Math.abs(cp) < LEVEL_CP) return "With this move the position is about level.";
  return `With this move you'd be about ${pawns(cp)} pawns ${cp > 0 ? "ahead" : "behind"}.`;
}

function comparisonText(fen: string, best: UciLine, second: UciLine | undefined): string | undefined {
  if (!second || best.cp === undefined || second.cp === undefined) return undefined;
  const nextSan = sanLine(fen, second.moves)[0];
  if (!nextSan) return undefined;
  const gap = best.cp - second.cp;
  return gap < CLOSE_CP
    ? `${nextSan} is about as good.`
    : `The next best move, ${nextSan}, is about ${pawns(gap)} pawns worse.`;
}
