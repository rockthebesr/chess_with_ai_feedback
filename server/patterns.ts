import type { AnalysisRecord, GameState, MistakePattern, MoveRecord, PlayerPatterns } from "../shared/types.js";
import { buildCoachingFacts } from "./coach-facts.js";

const patternText: Record<MistakePattern, { label: string; advice: string }> = {
  "allowed-mate": {
    label: "Allowed a forced mate",
    advice: "Before each move, look at every check your opponent would have next.",
  },
  "missed-mate": {
    label: "Missed a forced mate",
    advice: "When your opponent's king looks exposed, go through your own checks before anything else.",
  },
  "left-undefended": {
    label: "Left a piece undefended",
    advice:
      "After choosing a move, check that nothing you own is attacked with no defender, including what the move stops protecting.",
  },
  "attacked-by-cheaper": {
    label: "Left a piece open to a cheaper attacker",
    advice:
      "A defender does not help when a cheaper piece attacks. Check what can attack a square, not only what guards it.",
  },
  "allowed-capture": {
    label: "Allowed a capture that won material",
    advice: "Before each move, go through the captures your opponent would have next and count what each one wins.",
  },
  "missed-capture": {
    label: "Missed a good capture",
    advice: "At the start of each turn, look at every capture you have, even the ones that look like plain trades.",
  },
  other: { label: "Other mistakes", advice: "Use game review to compare these moves with what the engine preferred." },
};

/** Sorts one bad move into the first pattern it fits. Every label comes from checks on the board or engine scores. */
export function classifyMistake(move: MoveRecord, analysis: AnalysisRecord): MistakePattern {
  const sign = move.mover === "white" ? 1 : -1;
  const hadMate = (analysis.beforeMate ?? 0) * sign;
  const hasMate = (analysis.afterMate ?? 0) * sign;
  if (hasMate < 0 && hadMate >= 0) return "allowed-mate";
  if (hadMate > 0 && hasMate <= 0) return "missed-mate";
  const facts = buildCoachingFacts(move, analysis);
  if (facts.movedPieceLoose || facts.newlyLoosePieces.some((item) => item.color === facts.moverColor))
    return "left-undefended";
  if (facts.movedPieceOutranked || facts.newlyOutranked.length) return "attacked-by-cheaper";
  if (facts.reply?.capturedPiece && facts.reply.materialLost > 0) return "allowed-capture";
  if (analysis.alternatives[0]?.san[0]?.includes("x")) return "missed-capture";
  return "other";
}

/** Tallies mistakes by player across finished games. The bot's moves are never counted. */
export function summarizePatterns(
  games: GameState[],
  classify: (move: MoveRecord, analysis: AnalysisRecord) => MistakePattern = classifyMistake,
): PlayerPatterns[] {
  const players = new Map<string, { games: number; mistakes: number; counts: Map<MistakePattern, number> }>();
  for (const game of games) {
    if (game.status !== "complete" || !game.moves.length) continue;
    const seen = new Set<string>();
    for (const move of game.moves) {
      if (game.settings.mode === "bot" && move.mover !== game.settings.humanColor) continue;
      const name = move.mover === "white" ? game.settings.whiteName : game.settings.blackName;
      const player = players.get(name) ?? { games: 0, mistakes: 0, counts: new Map() };
      players.set(name, player);
      if (!seen.has(name)) {
        seen.add(name);
        player.games += 1;
      }
      const analysis = game.analysis[move.id];
      if (analysis?.status !== "complete" || (analysis.verdict !== "Mistake" && analysis.verdict !== "Blunder"))
        continue;
      const pattern = classify(move, analysis);
      player.mistakes += 1;
      player.counts.set(pattern, (player.counts.get(pattern) ?? 0) + 1);
    }
  }
  return [...players].map(([name, player]) => ({
    name,
    games: player.games,
    mistakes: player.mistakes,
    patterns: [...player.counts]
      .sort(([a, countA], [b, countB]) => Number(a === "other") - Number(b === "other") || countB - countA)
      .map(([id, count]) => ({ id, ...patternText[id], count, share: Math.round((count / player.mistakes) * 100) })),
  }));
}
