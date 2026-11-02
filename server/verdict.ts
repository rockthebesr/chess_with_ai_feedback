import type { Verdict } from "../shared/types.js";

export interface Score { cp?: number; mate?: number }

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
  if (before.mate !== undefined || after.mate !== undefined) {
    const moverSign = mover === "white" ? 1 : -1;
    const allowedMate = after.mate !== undefined && after.mate * moverSign < 0 && (before.mate === undefined || before.mate * moverSign >= 0);
    const escapedMate = before.mate !== undefined && before.mate * moverSign < 0 && (after.mate === undefined || after.mate * moverSign >= 0);
    if (allowedMate) return { verdict: "Mistake", note: "The move allows a forced mate according to the engine." };
    if (escapedMate) return { verdict: "Good move", note: "The move escapes a forced mate." };
    return { verdict: "Analysis uncertain", note: "Mate scores are kept separate from centipawn estimates." };
  }
  const lossCp = moverLoss(before, after, mover);
  if (lossCp === undefined) return { verdict: "Analysis uncertain", note: "Comparable engine scores were unavailable." };
  if (forcedMove) return { verdict: "Good move", lossCp, note: "This was the only legal move." };
  if (lossCp <= 45) return { verdict: "Good move", lossCp };
  if (lossCp <= 130) return { verdict: "Inaccuracy", lossCp };
  return { verdict: "Mistake", lossCp };
}
