import type { Verdict } from "../shared/types.js";

export interface Score { cp?: number; mate?: number }

const STILL_WINNING_CP = 700;
const LOSING_MATE_CP = 300;

export function whiteScore(score: Score, sideToMove: "w" | "b"): Score {
  const sign = sideToMove === "w" ? 1 : -1;
  return {
    cp: score.cp === undefined ? undefined : score.cp * sign,
    mate: score.mate === undefined ? undefined : score.mate * sign,
  };
}

export function moverLoss(before: Score, after: Score, mover: "white" | "black"): number | undefined {
  if (before.mate !== undefined || after.mate !== undefined || before.cp === undefined || after.cp === undefined) return undefined;
  return mover === "white" ? before.cp - after.cp : after.cp - before.cp;
}

export function verdictFor(before: Score, after: Score, mover: "white" | "black", forcedMove = false): { verdict: Verdict; lossCp?: number; note?: string } {
  if (forcedMove) return { verdict: "Good move", lossCp: moverLoss(before, after, mover), note: "This was the only legal move." };
  if (before.mate !== undefined || after.mate !== undefined) return mateVerdict(before, after, mover);
  const lossCp = moverLoss(before, after, mover);
  if (lossCp === undefined) return { verdict: "Analysis uncertain", note: "Comparable engine scores were unavailable." };
  if (lossCp <= 45) return { verdict: "Good move", lossCp };
  if (lossCp <= 130) return { verdict: "Inaccuracy", lossCp };
  if (lossCp <= 300) return { verdict: "Mistake", lossCp };
  return { verdict: "Blunder", lossCp };
}

/** Mate scores are compared by who is mating, never subtracted as centipawns. A score of 0 means the mover just delivered checkmate. */
function mateVerdict(before: Score, after: Score, mover: "white" | "black"): { verdict: Verdict; note: string } {
  if (after.mate === 0) return { verdict: "Good move", note: "The move delivers checkmate." };
  const sign = mover === "white" ? 1 : -1;
  const hadMate = (before.mate ?? 0) * sign;
  const hasMate = (after.mate ?? 0) * sign;
  if (hadMate > 0) {
    if (hasMate > 0) return { verdict: "Good move", note: hasMate < hadMate ? "The move keeps the forced mate on track." : "The move keeps a forced mate, though a faster one was available." };
    if (hasMate < 0) return { verdict: "Blunder", note: "The move throws away a forced mate and allows one against you." };
    if (after.cp === undefined) return { verdict: "Analysis uncertain", note: "Comparable engine scores were unavailable." };
    if (after.cp * sign >= STILL_WINNING_CP) return { verdict: "Inaccuracy", note: "The move misses a forced mate, but the position is still winning." };
    if (after.cp * sign >= LOSING_MATE_CP) return { verdict: "Mistake", note: "The move misses a forced mate." };
    return { verdict: "Blunder", note: "The move misses a forced mate and gives up the advantage." };
  }
  if (hadMate < 0) {
    if (hasMate >= 0) return { verdict: "Good move", note: "The move escapes a forced mate." };
    if (hasMate <= hadMate) return { verdict: "Good move", note: "The position was already lost to a forced mate; this move holds out as long as possible." };
    return { verdict: "Inaccuracy", note: "The position was already lost to a forced mate, but this move shortens the defense." };
  }
  if (hasMate > 0) return { verdict: "Good move", note: "The move creates a forced mate." };
  return { verdict: "Blunder", note: "The move allows a forced mate according to the engine." };
}
