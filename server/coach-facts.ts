import { Chess, SQUARES, type Move, type Square } from "chess.js";
import type { AnalysisRecord, MoveRecord, OpeningMatch } from "../shared/types.js";

const pieceNames: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const colorNames: Record<string, string> = { w: "White", b: "Black" };

export interface CoachFact { id: string; text: string }
export interface CoachingFacts {
  facts: CoachFact[];
  moverColor: "w" | "b";
  movingPiece: string;
  capturedPiece?: string;
  from: string;
  to: string;
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  gaveCheck: boolean;
  promotionPiece?: string;
  movedPieceAttacks: string[];
  movedPieceAttackers: string[];
  movedPieceDefenders: string[];
  movedPieceLoose: boolean;
  newlyAttackedPieces: Array<{ square: string; piece: string }>;
  loosePieces: Array<{ color: "w" | "b"; square: string; piece: string }>;
  newlyLoosePieces: Array<{ color: "w" | "b"; square: string; piece: string }>;
  rescuedPieces: Array<{ color: "w" | "b"; square: string; piece: string }>;
  lineMotifs: Array<{ type: "pin" | "skewer" | "x-ray"; frontSquare: string; frontPiece: string; behindSquare: string; behindPiece: string }>;
  /** Pieces the moved piece really threatens at once: the king, undefended pieces, or pieces worth more than it. */
  forkTargets: Array<{ square: string; piece: string }>;
  /** The moved piece can be taken by something cheaper, so a defender would not save the trade. */
  movedPieceOutranked?: { square: string; piece: string };
  /** Other pieces of the mover's that this move newly left attacked by something cheaper. */
  newlyOutranked: Array<{ square: string; piece: string; attackerSquare: string; attacker: string }>;
  /** The engine's best answer to this move, replayed on the board. */
  reply?: { san: string; capturedPiece?: string; capturedSquare?: string; gaveCheck: boolean; materialLost: number };
  materialSwing: number;
  developedFromHome: boolean;
  castled: boolean;
  centralPawnMove: boolean;
}

const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const homeSquares: Record<string, string[]> = { n: ["b1", "g1", "b8", "g8"], b: ["c1", "f1", "c8", "f8"] };

function inventory(chess: Chess): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of chess.board()) for (const piece of row) if (piece) {
    const key = `${piece.color}${piece.type}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function inventoryText(counts: Record<string, number>, color: "w" | "b"): string {
  return ["q", "r", "b", "n", "p"].map((piece) => `${counts[`${color}${piece}`] ?? 0} ${pieceNames[piece]}${(counts[`${color}${piece}`] ?? 0) === 1 ? "" : "s"}`).join(", ");
}

export function buildCoachingFacts(move: MoveRecord, analysis: AnalysisRecord, opening?: OpeningMatch): CoachingFacts {
  const before = new Chess(move.beforeFen);
  const beforeCounts = inventory(before);
  const applied = before.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] });
  const afterCounts = inventory(before);
  const moverColor = applied.color;
  const facts: CoachFact[] = [
    { id: "played_move", text: `${colorNames[moverColor]} moved its ${pieceNames[applied.piece]} from ${applied.from} to ${applied.to}; the move notation is ${applied.san}.` },
    { id: "material_after", text: `After the move, White has ${inventoryText(afterCounts, "w")}; Black has ${inventoryText(afterCounts, "b")}.` },
    { id: "engine_verdict", text: `The verified verdict for the move is ${analysis.verdict}.` },
  ];
  if (applied.captured) facts.push({ id: "capture", text: `${colorNames[moverColor]}'s ${pieceNames[applied.piece]} captured ${colorNames[moverColor === "w" ? "b" : "w"]}'s ${pieceNames[applied.captured]} on ${applied.to}.` });
  else facts.push({ id: "capture", text: "No piece was captured by this move." });
  const gaveCheck = before.isCheck();
  if (gaveCheck) facts.push({ id: "check", text: `${colorNames[moverColor === "w" ? "b" : "w"]} is in check after the move.` });
  else facts.push({ id: "check", text: "The move did not give check." });
  const promotionPiece = applied.promotion ? pieceNames[applied.promotion] : undefined;
  if (promotionPiece) facts.push({ id: "promotion", text: `The pawn promoted to a ${promotionPiece} on ${applied.to}.` });
  const movedPieceAttacks = attacksForPiece(before, applied.to, applied.promotion ?? applied.piece, applied.color);
  const opponent = applied.color === "w" ? "b" : "w";
  const movedPieceAttackers = legalCapturers(before, applied.to, opponent);
  const movedPieceDefenders = legalDefenders(before, applied.to, applied.color);
  const movedPieceLoose = applied.piece !== "k" && movedPieceAttackers.length > 0 && movedPieceDefenders.length === 0;
  const newlyAttackedPieces = movedPieceAttacks.flatMap((square) => {
    const target = before.get(square as Square);
    return target && target.color === opponent && target.type !== "k" && legalCapturers(before, square as Square, applied.color).includes(applied.to)
      ? [{ square, piece: pieceNames[target.type] }] : [];
  });
  const loosePieces = findLoosePieces(before);
  const beforePosition = new Chess(move.beforeFen);
  const looseBefore = findLoosePieces(beforePosition);
  const looseBeforeKeys = new Set(looseBefore.map(pieceKey));
  const looseAfterKeys = new Set(loosePieces.map(pieceKey));
  const newlyLoosePieces = loosePieces.filter((item) => !looseBeforeKeys.has(pieceKey(item)));
  const rescuedPieces = looseBefore.filter((item) => !looseAfterKeys.has(pieceKey(item)) && !(applied.captured && item.square === applied.to));
  const movedValue = pieceValues[applied.promotion ?? applied.piece];
  const cheapestOnMoved = cheapestCapturer(before, applied.to, opponent);
  const movedPieceOutranked = applied.piece !== "k" && cheapestOnMoved && pieceValues[cheapestOnMoved.type] < movedValue && movedValue > (applied.captured ? pieceValues[applied.captured] : 0)
    ? { square: cheapestOnMoved.square, piece: pieceNames[cheapestOnMoved.type] } : undefined;
  const newlyOutranked = SQUARES.flatMap((square) => {
    const target = before.get(square);
    if (!target || target.color !== applied.color || target.type === "k" || square === applied.to) return [];
    const now = cheapestCapturer(before, square, opponent);
    if (!now || pieceValues[now.type] >= pieceValues[target.type]) return [];
    const earlier = beforePosition.get(square)?.type === target.type ? cheapestCapturer(beforePosition, square, opponent) : undefined;
    if (earlier && pieceValues[earlier.type] < pieceValues[target.type]) return [];
    return [{ square, piece: pieceNames[target.type], attackerSquare: now.square, attacker: pieceNames[now.type] }];
  });
  const movedPieceCapturable = movedPieceLoose || Boolean(movedPieceOutranked);
  const forkTargets = movedPieceCapturable ? [] : movedPieceAttacks.flatMap((square) => {
    const target = before.get(square as Square);
    if (!target || target.color !== opponent) return [];
    if (target.type === "k") return [{ square, piece: "king" }];
    if (!newlyAttackedPieces.some((item) => item.square === square)) return [];
    return pieceValues[target.type] > movedValue || !legalDefenders(before, square as Square, opponent).length ? [{ square, piece: pieceNames[target.type] }] : [];
  });
  const lineMotifs = findLineMotifs(before, applied.to, applied.promotion ?? applied.piece, applied.color);
  const materialSwing = materialBalance(afterCounts, applied.color) - materialBalance(beforeCounts, applied.color);
  const developedFromHome = ["n", "b"].includes(applied.piece) && homeSquares[applied.piece].includes(applied.from);
  const castled = applied.isKingsideCastle() || applied.isQueensideCastle();
  const centralPawnMove = applied.piece === "p" && ["d", "e"].includes(applied.from[0]);
  facts.push({ id: "piece_scope", text: `From ${applied.to}, the moved ${pieceNames[applied.promotion ?? applied.piece]} attacks ${movedPieceAttacks.length ? movedPieceAttacks.join(", ") : "no squares"}; it can legally be captured by ${movedPieceAttackers.length ? movedPieceAttackers.join(", ") : "no opponent piece"} and has ${movedPieceDefenders.length ? `legal defenders on ${movedPieceDefenders.join(", ")}` : "no legal defender"}.` });
  if (loosePieces.length) facts.push({ id: "loose_pieces", text: `Legally attacked and undefended pieces after the move: ${loosePieces.map((item) => `${colorNames[item.color]} ${item.piece} on ${item.square}`).join("; ")}.` });
  if (newlyLoosePieces.length) facts.push({ id: "newly_loose", text: `Pieces that became legally attacked and undefended on this move: ${newlyLoosePieces.map((item) => `${colorNames[item.color]} ${item.piece} on ${item.square}`).join("; ")}.` });
  if (movedPieceOutranked || newlyOutranked.length) facts.push({ id: "outranked", text: `Pieces of the mover's attacked by something cheaper after the move: ${[...(movedPieceOutranked ? [`${pieceNames[applied.piece]} on ${applied.to} by the ${movedPieceOutranked.piece} on ${movedPieceOutranked.square}`] : []), ...newlyOutranked.map((item) => `${item.piece} on ${item.square} by the ${item.attacker} on ${item.attackerSquare}`)].join("; ")}.` });
  if (rescuedPieces.length) facts.push({ id: "rescued", text: `Pieces that are no longer both attacked and undefended: ${rescuedPieces.map((item) => `${colorNames[item.color]} ${item.piece} formerly on ${item.square}`).join("; ")}.` });
  if (lineMotifs.length) facts.push({ id: "line_motifs", text: `Verified line motifs created by the moved piece: ${lineMotifs.map((item) => `${item.type} through the ${item.frontPiece} on ${item.frontSquare} toward the ${item.behindPiece} on ${item.behindSquare}`).join("; ")}.` });
  facts.push({ id: "material_change", text: `The move changed ${colorNames[applied.color]}'s material balance by ${materialSwing} pawn-value units from captures or promotion.` });
  if (newlyAttackedPieces.length) facts.push({ id: "new_attacks", text: `The moved piece can legally capture: ${newlyAttackedPieces.map((item) => `${item.piece} on ${item.square}`).join(", ")}.` });
  if (developedFromHome) facts.push({ id: "development", text: `The move developed a ${pieceNames[applied.piece]} from its starting square.` });
  if (castled) facts.push({ id: "castling", text: `${colorNames[applied.color]} castled on this move.` });
  if (centralPawnMove) facts.push({ id: "central_pawn", text: `The move advanced the ${applied.from[0]}-pawn from ${applied.from} to ${applied.to}.` });
  const reply = replayReply(move.afterFen, analysis, moverColor);
  const best = analysis.alternatives[0];
  if (best?.san[0]) facts.push({ id: "best_alternative", text: `Before the move, Stockfish's verified first alternative was ${best.san[0]}.` });
  if (analysis.continuation?.san.length) facts.push({ id: "reply", text: `After the move, Stockfish's verified continuation begins ${analysis.continuation.san.slice(0, 3).join(" ")}.` });
  if (opening) facts.push({ id: "opening", text: opening.guidanceAvailable
    ? `At this move the opening was ${opening.name}${opening.current ? "" : " (the game had left the named book line)"}. The mover's verified stored plan was: ${moverColor === "w" ? opening.plansWhite : opening.plansBlack}`
    : `At this move the position book identified ${opening.name}${opening.current ? "" : " before the game left the named line"}; no opening-specific strategic plan is stored.` });
  return { facts, moverColor, movingPiece: pieceNames[applied.piece], capturedPiece: applied.captured ? pieceNames[applied.captured] : undefined, from: applied.from, to: applied.to, beforeCounts, afterCounts, gaveCheck, promotionPiece, movedPieceAttacks, movedPieceAttackers, movedPieceDefenders, movedPieceLoose, newlyAttackedPieces, loosePieces, newlyLoosePieces, rescuedPieces, lineMotifs, forkTargets, movedPieceOutranked, newlyOutranked, reply, materialSwing, developedFromHome, castled, centralPawnMove };
}

export function factsPacket(facts: CoachingFacts): object {
  return { facts: facts.facts, instruction: "Use only these facts for factual chess claims. Cite the supporting fact IDs in evidenceIds." };
}

function replayReply(afterFen: string, analysis: AnalysisRecord, moverColor: "w" | "b"): CoachingFacts["reply"] {
  const line = analysis.continuation?.uci ?? [];
  if (!line.length) return undefined;
  const board = new Chess(afterFen);
  const start = materialBalance(inventory(board), moverColor);
  let first: Move | undefined;
  let materialLost = 0;
  for (const uci of line) {
    let played: Move;
    try { played = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { break; }
    first ??= played;
    // A line can stop mid-exchange, so only count material once a quiet move shows the trades have finished.
    if (!played.captured) materialLost = start - materialBalance(inventory(board), moverColor);
  }
  if (!first) return undefined;
  return {
    san: first.san, capturedPiece: first.captured ? pieceNames[first.captured] : undefined, capturedSquare: first.captured ? first.to : undefined,
    gaveCheck: first.san.includes("+") || first.san.includes("#"), materialLost: Math.max(0, materialLost),
  };
}

function withTurn(chess: Chess, color: "w" | "b"): Chess {
  const parts = chess.fen().split(" ");
  parts[1] = color;
  parts[3] = "-";
  return new Chess(parts.join(" "));
}

function legalCapturers(chess: Chess, target: Square, color: "w" | "b"): string[] {
  try { return withTurn(chess, color).moves({ verbose: true }).filter((move) => move.to === target && Boolean(move.captured)).map((move) => move.from); }
  catch { return chess.attackers(target, color); }
}

function legalDefenders(chess: Chess, target: Square, color: "w" | "b"): string[] {
  const clone = new Chess(chess.fen());
  const occupant = clone.get(target);
  if (!occupant || occupant.color !== color || occupant.type === "k") return [];
  clone.remove(target);
  clone.put({ type: "p", color: color === "w" ? "b" : "w" }, target);
  return legalCapturers(clone, target, color);
}

function cheapestCapturer(chess: Chess, target: Square, color: "w" | "b"): { square: string; type: string } | undefined {
  const capturers = legalCapturers(chess, target, color).flatMap((square) => {
    const piece = chess.get(square as Square);
    return piece ? [{ square, type: piece.type }] : [];
  });
  return capturers.sort((a, b) => pieceValues[a.type] - pieceValues[b.type])[0];
}

function materialBalance(counts: Record<string, number>, color: "w" | "b"): number {
  const opponent = color === "w" ? "b" : "w";
  return ["p", "n", "b", "r", "q"].reduce((total, piece) => total + ((counts[`${color}${piece}`] ?? 0) - (counts[`${opponent}${piece}`] ?? 0)) * pieceValues[piece], 0);
}

function pieceKey(item: { color: "w" | "b"; square: string; piece: string }): string { return `${item.color}:${item.square}:${item.piece}`; }

function findLoosePieces(chess: Chess): Array<{ color: "w" | "b"; square: string; piece: string }> {
  return SQUARES.flatMap((square) => {
    const target = chess.get(square);
    if (!target || target.type === "k") return [];
    const enemy = target.color === "w" ? "b" : "w";
    return legalCapturers(chess, square, enemy).length && !legalDefenders(chess, square, target.color).length
      ? [{ color: target.color, square, piece: pieceNames[target.type] }] : [];
  });
}

function findLineMotifs(chess: Chess, from: Square, piece: string, color: "w" | "b"): CoachingFacts["lineMotifs"] {
  if (!["b", "r", "q"].includes(piece)) return [];
  const directions = piece === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
    : piece === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const file = from.charCodeAt(0) - 97; const rank = Number(from[1]) - 1;
  const result: CoachingFacts["lineMotifs"] = [];
  const opponent = color === "w" ? "b" : "w";
  for (const [df, dr] of directions) {
    const occupied: Array<{ square: Square; piece: NonNullable<ReturnType<Chess["get"]>> }> = [];
    for (let step = 1; step < 8; step += 1) {
      const square = toSquare(file + df * step, rank + dr * step); if (!square) break;
      const target = chess.get(square); if (target) occupied.push({ square, piece: target });
      if (occupied.length === 2) break;
    }
    if (occupied.length < 2 || occupied[0].piece.color === color || occupied[1].piece.color === color) continue;
    const [front, behind] = occupied;
    const type = motifType(front.piece.type, behind.piece.type, legalCapturers(chess, from, opponent).includes(front.square));
    result.push({ type, frontSquare: front.square, frontPiece: pieceNames[front.piece.type], behindSquare: behind.square, behindPiece: pieceNames[behind.piece.type] });
  }
  return result;
}

function motifType(front: string, behind: string, frontCanCaptureAttacker: boolean): CoachingFacts["lineMotifs"][number]["type"] {
  // A piece that can simply take the attacker is not pinned or skewered.
  if (frontCanCaptureAttacker) return "x-ray";
  if (behind === "k" || (front !== "k" && pieceValues[behind] > pieceValues[front])) return "pin";
  if (front === "k" || (pieceValues[front] > pieceValues[behind] && behind !== "p")) return "skewer";
  return "x-ray";
}

function attacksForPiece(chess: Chess, square: Square, piece: string, color: "w" | "b"): string[] {
  const file = square.charCodeAt(0) - 97; const rank = Number(square[1]) - 1;
  const jumps = piece === "n" ? [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
    : piece === "k" ? [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
    : piece === "p" ? [[-1, color === "w" ? 1 : -1], [1, color === "w" ? 1 : -1]] : [];
  if (jumps.length) return jumps.map(([df, dr]) => toSquare(file + df, rank + dr)).filter((item): item is Square => Boolean(item));
  const directions = piece === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
    : piece === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : piece === "q" ? [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] : [];
  const result: string[] = [];
  for (const [df, dr] of directions) for (let step = 1; step < 8; step += 1) {
    const target = toSquare(file + df * step, rank + dr * step); if (!target) break;
    result.push(target); if (chess.get(target)) break;
  }
  return result;
}

function toSquare(file: number, rank: number): Square | undefined {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return undefined;
  const square = `${String.fromCharCode(97 + file)}${rank + 1}` as Square;
  return SQUARES.includes(square) ? square : undefined;
}
