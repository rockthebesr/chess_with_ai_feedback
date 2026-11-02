import { Chess } from "chess.js";
import type { AnalysisRecord, CandidateLine, Color, MoveRecord } from "../shared/types.js";
import { verdictFor, whiteScore } from "./verdict.js";
import type { UciEngine, UciLine } from "./uci.js";

function lineToCandidate(fen: string, line: UciLine, id: string): CandidateLine {
  const chess = new Chess(fen);
  const san: string[] = [];
  const uci: string[] = [];
  for (const move of line.moves.slice(0, 6)) {
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move[4];
    try {
      const applied = chess.move({ from, to, promotion });
      san.push(applied.san);
      uci.push(move);
    } catch {
      break;
    }
  }
  const oriented = whiteScore({ cp: line.cp, mate: line.mate }, new Chess(fen).turn());
  return { id, scoreCp: oriented.cp, mate: oriented.mate, uci, san };
}

export async function analyzeMove(
  engine: UciEngine | undefined,
  move: MoveRecord,
  legalMoveCount: number,
  budgetMs = 650,
): Promise<AnalysisRecord> {
  if (!engine)
    return fallbackAnalysis(move, "Stockfish was not found; showing deterministic rules-based feedback.", budgetMs);
  try {
    // Bot play uses a different UCI process; this analysis worker can spend its full budget.
    const beforeRaw = await engine.analyze(move.beforeFen, budgetMs, 3);
    // The engine reports no line for a finished game, so these results come from the rules instead.
    const position = new Chess(move.afterFen);
    const finished = position.isCheckmate() ? { mate: 0 } : position.isStalemate() ? { cp: 0 } : undefined;
    const afterLine = finished ? undefined : (await engine.analyze(move.afterFen, budgetMs, 1)).lines[0];
    const beforeLine = beforeRaw.lines[0];
    if (!beforeLine || (!finished && !afterLine))
      return fallbackAnalysis(move, "The engine returned no comparable score.", budgetMs);
    const before = whiteScore({ cp: beforeLine.cp, mate: beforeLine.mate }, new Chess(move.beforeFen).turn());
    const after = finished ?? whiteScore({ cp: afterLine!.cp, mate: afterLine!.mate }, position.turn());
    const judged = verdictFor(before, after, move.mover, legalMoveCount === 1);
    return {
      moveId: move.id,
      status: "complete",
      verdict: judged.verdict,
      beforeCp: before.cp,
      afterCp: after.cp,
      beforeMate: before.mate,
      afterMate: after.mate,
      lossCp: judged.lossCp,
      depth: Math.min(beforeLine.depth, afterLine?.depth ?? beforeLine.depth),
      budgetMs,
      engine: engine.version,
      alternatives: beforeRaw.lines.map((line, i) => lineToCandidate(move.beforeFen, line, `v${i + 1}`)),
      continuation: afterLine && lineToCandidate(move.afterFen, afterLine, "reply"),
      note: judged.note,
    };
  } catch (error) {
    return fallbackAnalysis(move, error instanceof Error ? error.message : "Engine analysis failed.", budgetMs);
  }
}

function material(fen: string): number {
  const values: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const chess = new Chess(fen);
  let score = 0;
  for (const row of chess.board())
    for (const piece of row) if (piece) score += values[piece.type] * (piece.color === "w" ? 1 : -1);
  return score;
}

export function fallbackAnalysis(move: MoveRecord, note: string, budgetMs = 0): AnalysisRecord {
  const beforeCp = material(move.beforeFen);
  const afterCp = material(move.afterFen);
  const judged = verdictFor({ cp: beforeCp }, { cp: afterCp }, move.mover);
  return {
    moveId: move.id,
    status: "unavailable",
    verdict: "Analysis uncertain",
    beforeCp,
    afterCp,
    lossCp: judged.lossCp,
    budgetMs,
    engine: "rules fallback",
    alternatives: [],
    note,
  };
}

export function chooseFallbackBotMove(chess: Chess): { from: string; to: string; promotion?: string } {
  const moves = chess.moves({ verbose: true });
  const captures = moves.filter((move) => move.captured);
  const pool = captures.length ? captures : moves;
  const move = pool[Math.floor(Math.random() * pool.length)];
  return { from: move.from, to: move.to, promotion: move.promotion };
}

export async function chooseBotMove(
  engine: UciEngine | undefined,
  fen: string,
  difficulty: string,
): Promise<{ from: string; to: string; promotion?: string }> {
  const chess = new Chess(fen);
  if (!engine) return chooseFallbackBotMove(chess);
  const settings: Record<string, { ms: number; skill: number }> = {
    beginner: { ms: 100, skill: 0 },
    easy: { ms: 180, skill: 5 },
    medium: { ms: 350, skill: 10 },
    strong: { ms: 700, skill: 16 },
  };
  try {
    const selected = settings[difficulty] ?? settings.easy;
    const result = await engine.analyze(fen, selected.ms, 1, selected.skill);
    if (!result.bestMove || result.bestMove === "(none)") return chooseFallbackBotMove(chess);
    return { from: result.bestMove.slice(0, 2), to: result.bestMove.slice(2, 4), promotion: result.bestMove[4] };
  } catch {
    return chooseFallbackBotMove(chess);
  }
}

export function playerForTurn(turn: "w" | "b"): Color {
  return turn === "w" ? "white" : "black";
}
