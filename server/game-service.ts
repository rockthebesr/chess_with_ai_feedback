import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import type {
  AnalysisRecord, CoachingRecord, GameSettings, GameState, GameSummary, MoveRecord,
  ProviderStatus, ServerEvent,
} from "../shared/types.js";
import { analyzeMove, chooseBotMove, playerForTurn } from "./analysis.js";
import { fallbackCoaching, type CoachProvider } from "./coach.js";
import { recognizeOpening } from "./openings.js";
import { Storage } from "./storage.js";
import type { UciEngine } from "./uci.js";
import { winChanceLoss } from "./verdict.js";

const defaultSettings: GameSettings = {
  mode: "bot", whiteName: "Rock", blackName: "Coach Bot", humanColor: "white",
  difficulty: "easy", practice: "normal", autoFlip: false, hintsVisible: false,
  boardTheme: "forest", pieceStyle: "classic",
};

function now(): string { return new Date().toISOString(); }

function chessFor(game: GameState, throughPly = game.moves.length): Chess {
  const chess = new Chess();
  for (const move of game.moves.slice(0, throughPly)) {
    chess.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] });
  }
  return chess;
}

function legalMoves(chess: Chess): GameState["legalMoves"] {
  if (chess.isGameOver()) return [];
  return chess.moves({ verbose: true }).map((move) => ({ from: move.from, to: move.to, promotion: move.promotion }));
}

function resultFor(chess: Chess): { status: GameState["status"]; result: string; reason?: string } {
  if (chess.isCheckmate()) return { status: "complete", result: chess.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (chess.isStalemate()) return { status: "complete", result: "1/2-1/2", reason: "stalemate" };
  if (chess.isThreefoldRepetition()) return { status: "complete", result: "1/2-1/2", reason: "threefold repetition" };
  if (chess.isInsufficientMaterial()) return { status: "complete", result: "1/2-1/2", reason: "insufficient material" };
  if (chess.isDrawByFiftyMoves()) return { status: "complete", result: "1/2-1/2", reason: "fifty-move rule" };
  if (chess.isDraw()) return { status: "complete", result: "1/2-1/2", reason: "draw" };
  return { status: "active", result: "*" };
}

function botColor(game: GameState): "white" | "black" {
  return game.settings.humanColor === "white" ? "black" : "white";
}

function moveWinChanceLoss({ move, analysis }: { move: MoveRecord; analysis: AnalysisRecord }): number {
  return winChanceLoss({ cp: analysis.beforeCp, mate: analysis.beforeMate }, { cp: analysis.afterCp, mate: analysis.afterMate }, move.mover) ?? 0;
}

const LIVE_ANALYSIS_MS = 450;
const RECHECK_ANALYSIS_MS = 1500;
// Moves this close to the inaccuracy line can flip between searches, so they are rechecked too.
const RECHECK_MIN_LOSS = 3;
const BOT_THINKING_MS = 850;
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class GameService {
  private games = new Map<string, GameState>();
  private coachingChains = new Map<string, Promise<void>>();
  private tasks = new Set<Promise<unknown>>();
  private announcedProvider: string;
  private recheckedBranches = new Set<string>();

  constructor(
    readonly storage: Storage,
    private readonly coach: CoachProvider,
    private readonly analysisEngine: UciEngine | undefined,
    private readonly botEngine: UciEngine | undefined,
    private readonly emit: (event: ServerEvent) => void,
  ) {
    for (const summary of storage.listGames()) {
      const game = storage.loadGame(summary.id);
      if (game) this.games.set(game.id, this.withSettingDefaults(game));
    }
    this.announcedProvider = JSON.stringify(coach.status());
    for (const game of this.games.values()) this.resumeBot(game);
  }

  list(): GameSummary[] { return this.storage.listGames(); }
  get(id: string): GameState | undefined { return this.games.get(id) ?? this.load(id); }
  providerStatus(): ProviderStatus { return this.coach.status(); }

  private load(id: string): GameState | undefined {
    const game = this.storage.loadGame(id);
    if (game) this.games.set(id, this.withSettingDefaults(game));
    return game;
  }

  private withSettingDefaults(game: GameState): GameState {
    game.settings = { ...defaultSettings, ...game.settings };
    return game;
  }

  create(input: Partial<GameSettings>): GameState {
    const settings: GameSettings = {
      ...defaultSettings, ...input,
      whiteName: (input.whiteName || defaultSettings.whiteName).slice(0, 40),
      blackName: (input.blackName || (input.mode === "local" ? "Christine" : defaultSettings.blackName)).slice(0, 40),
    };
    if (settings.mode === "bot") {
      if (settings.humanColor === "black") {
        settings.blackName = input.blackName || "Rock";
        settings.whiteName = "Coach Bot";
      } else {
        settings.whiteName = input.whiteName || "Rock";
        settings.blackName = "Coach Bot";
      }
    }
    const chess = new Chess();
    const timestamp = now();
    const game: GameState = {
      id: randomUUID(), branchId: randomUUID(), revision: 0, settings, fen: chess.fen(),
      turn: "white", status: "active", result: "*", paused: false, pgn: "", moves: [],
      legalMoves: legalMoves(chess), analysis: {}, coaching: {}, createdAt: timestamp, updatedAt: timestamp,
    };
    this.games.set(game.id, game);
    this.persistAndEmit(game);
    if (settings.mode === "bot" && botColor(game) === "white") this.track(this.scheduleBot(game));
    return game;
  }

  async move(id: string, intent: { from: string; to: string; promotion?: string; expectedRevision: number }, source: "human" | "bot" = "human"): Promise<GameState> {
    const game = this.requireGame(id);
    if (game.status !== "active") throw new ServiceError(409, "This game has ended.");
    if (game.paused) throw new ServiceError(409, "Guided practice is paused. Choose Continue first.");
    if (intent.expectedRevision !== game.revision) throw new ServiceError(409, "The board changed. Refresh and try again.");
    if (game.settings.mode === "bot" && source === "human" && game.turn === botColor(game)) throw new ServiceError(409, "It is the bot's turn.");
    const chess = chessFor(game);
    const beforeFen = chess.fen();
    const beforeLegalCount = chess.moves().length;
    let applied;
    try { applied = chess.move({ from: intent.from, to: intent.to, promotion: intent.promotion }); }
    catch { throw new ServiceError(400, "That move is not legal in the current position."); }
    const moveRevision = game.revision + 1;
    const record: MoveRecord = {
      id: randomUUID(), gameId: game.id, branchId: game.branchId, revision: moveRevision,
      ply: game.moves.length + 1, mover: applied.color === "w" ? "white" : "black",
      beforeFen, afterFen: chess.fen(), san: applied.san,
      uci: `${applied.from}${applied.to}${applied.promotion ?? ""}`, createdAt: now(),
    };
    game.revision = moveRevision;
    game.moves.push(record);
    game.analysis[record.id] = {
      moveId: record.id, status: "pending", verdict: "Analysis uncertain", budgetMs: LIVE_ANALYSIS_MS,
      engine: this.analysisEngine?.version ?? "rules fallback", alternatives: [],
    };
    game.coaching[record.id] = { moveId: record.id, status: source === "bot" ? "skipped" : "queued" };
    this.refreshDerived(game, chess);
    game.paused = game.settings.practice === "guided" && game.status === "active";
    this.persistAndEmit(game);
    this.track(this.runAnalysis(game.id, record, beforeLegalCount));
    if (!game.paused && game.settings.mode === "bot" && game.status === "active" && game.turn === botColor(game)) {
      this.track(this.scheduleBot(game));
    }
    return game;
  }

  private async runAnalysis(gameId: string, move: MoveRecord, legalMoveCount: number): Promise<void> {
    const analysis = await analyzeMove(this.analysisEngine, move, legalMoveCount, LIVE_ANALYSIS_MS);
    const game = this.get(gameId);
    if (!game || !this.isCurrentMove(game, move)) return;
    game.analysis[move.id] = analysis;
    game.updatedAt = now();
    this.storage.saveGame(game);
    this.emit({ type: "analysis.updated", gameId, moveId: move.id, analysis });
    if (game.coaching[move.id]?.status !== "skipped") this.enqueueCoaching(gameId, move);
    this.scheduleRecheck(game);
  }

  /** Runs once per finished branch, after the last live analysis lands. */
  private scheduleRecheck(game: GameState): void {
    if (!this.analysisEngine || game.status !== "complete" || this.recheckedBranches.has(game.branchId)) return;
    if (game.moves.some((move) => game.analysis[move.id]?.status === "pending")) return;
    this.recheckedBranches.add(game.branchId);
    this.track(this.recheckVerdicts(game.id, game.branchId));
  }

  /** Live searches are short, so verdicts that could matter get a longer look once nobody is waiting on them. */
  private async recheckVerdicts(gameId: string, branchId: string): Promise<void> {
    const moves = this.get(gameId)?.moves ?? [];
    for (const move of moves) {
      const current = this.get(gameId)?.analysis[move.id];
      if (!current || current.status !== "complete" || !this.worthRechecking(move, current)) continue;
      const rechecked = await analyzeMove(this.analysisEngine, move, new Chess(move.beforeFen).moves().length, RECHECK_ANALYSIS_MS);
      const game = this.get(gameId);
      if (!game || game.branchId !== branchId || !this.isCurrentMove(game, move)) return;
      if (rechecked.status !== "complete") continue;
      game.analysis[move.id] = { ...rechecked, rechecked: true };
      game.updatedAt = now();
      this.storage.saveGame(game);
      this.emit({ type: "analysis.updated", gameId, moveId: move.id, analysis: game.analysis[move.id] });
      const coachingStatus = game.coaching[move.id]?.status;
      if (rechecked.verdict !== current.verdict && coachingStatus !== "skipped") this.enqueueCoaching(gameId, move);
    }
  }

  private worthRechecking(move: MoveRecord, analysis: AnalysisRecord): boolean {
    return !analysis.rechecked && (analysis.verdict !== "Good move" || moveWinChanceLoss({ move, analysis }) >= RECHECK_MIN_LOSS);
  }

  private enqueueCoaching(gameId: string, move: MoveRecord): void {
    const run = async () => {
      await this.coach.refresh?.();
      this.announceProvider();
      const game = this.get(gameId);
      if (!game || !this.isCurrentMove(game, move)) return;
      const analysis = game.analysis[move.id];
      const openingAtMove = recognizeOpening(game.moves.slice(0, move.ply).map((item) => item.san));
      if (!this.coach.status().available) {
        game.coaching[move.id] = { ...fallbackCoaching(move, analysis, openingAtMove, game.settings.hintsVisible), followups: game.coaching[move.id]?.followups };
        this.storage.saveGame(game);
        this.emit({ type: "coaching.updated", gameId, moveId: move.id, coaching: game.coaching[move.id] });
        return;
      }
      const streaming: CoachingRecord = { moveId: move.id, status: "streaming", streamedText: "", followups: game.coaching[move.id]?.followups };
      game.coaching[move.id] = streaming;
      this.emit({ type: "coaching.updated", gameId, moveId: move.id, coaching: streaming });
      try {
        const result = await this.coach.coach(game, move, analysis, openingAtMove, (text) => {
          const latest = this.get(gameId);
          if (!latest || !this.isCurrentMove(latest, move)) return;
          const partial: CoachingRecord = { ...latest.coaching[move.id], status: "streaming", streamedText: text };
          latest.coaching[move.id] = partial;
          this.emit({ type: "coaching.updated", gameId, moveId: move.id, coaching: partial });
        });
        this.announceProvider();
        const source = result.source ?? this.coach.status();
        const latest = this.get(gameId);
        if (!latest || !this.isCurrentMove(latest, move)) return;
        latest.coaching[move.id] = {
          moveId: move.id, status: "complete", verdict: result.verdict,
          explanation: result.explanation, lesson: result.lesson,
          provider: source.authMode === "local" ? "Local Gemma" : "Codex App Server", model: source.model,
          followups: latest.coaching[move.id]?.followups,
        };
        this.storage.saveGame(latest);
        this.emit({ type: "coaching.updated", gameId, moveId: move.id, coaching: latest.coaching[move.id] });
      } catch (error) {
        this.announceProvider();
        const latest = this.get(gameId);
        if (!latest || !this.isCurrentMove(latest, move)) return;
        const fallback = fallbackCoaching(move, analysis, recognizeOpening(latest.moves.slice(0, move.ply).map((item) => item.san)), latest.settings.hintsVisible);
        fallback.error = error instanceof Error ? error.message : "Coaching failed.";
        fallback.followups = latest.coaching[move.id]?.followups;
        latest.coaching[move.id] = fallback;
        this.storage.saveGame(latest);
        this.emit({ type: "coaching.updated", gameId, moveId: move.id, coaching: fallback });
      }
    };
    const previous = this.coachingChains.get(gameId) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.coachingChains.set(gameId, next);
    void next.finally(() => { if (this.coachingChains.get(gameId) === next) this.coachingChains.delete(gameId); });
  }

  private resumeBot(game: GameState): void {
    if (game.settings.mode === "bot" && game.status === "active" && !game.paused && game.turn === botColor(game)) this.track(this.scheduleBot(game));
  }

  private announceProvider(): void {
    const provider = this.coach.status();
    const serialized = JSON.stringify(provider);
    if (serialized === this.announcedProvider) return;
    this.announcedProvider = serialized;
    this.emit({ type: "provider.updated", provider });
  }

  private async scheduleBot(game: GameState): Promise<void> {
    const branchId = game.branchId;
    const revision = game.revision;
    const fen = game.fen;
    const selected = await chooseBotMove(this.botEngine, fen, game.settings.difficulty);
    await wait(BOT_THINKING_MS);
    const latest = this.get(game.id);
    if (!latest || latest.branchId !== branchId || latest.revision !== revision || latest.paused || latest.status !== "active") return;
    if (latest.turn !== botColor(latest)) return;
    await this.move(latest.id, { ...selected, expectedRevision: revision }, "bot").catch(() => undefined);
  }

  async continue(id: string, expectedRevision: number): Promise<GameState> {
    const game = this.requireGame(id);
    if (game.revision !== expectedRevision) throw new ServiceError(409, "The board changed. Refresh and try again.");
    game.paused = false;
    game.updatedAt = now();
    this.persistAndEmit(game);
    if (game.settings.mode === "bot" && game.status === "active" && game.turn === botColor(game)) this.track(this.scheduleBot(game));
    return game;
  }

  async undo(id: string): Promise<GameState> {
    const game = this.requireGame(id);
    if (!game.moves.length) throw new ServiceError(409, "There are no moves to take back.");
    let count = 1;
    if (game.settings.mode === "bot" && game.moves.length >= 2 && game.turn !== botColor(game)) count = 2;
    const removed = game.moves.splice(Math.max(0, game.moves.length - count), count);
    for (const move of removed) {
      await this.coach.cancel(move.id);
      delete game.analysis[move.id]; delete game.coaching[move.id];
    }
    game.branchId = randomUUID();
    game.revision += 1;
    game.paused = false;
    this.refreshDerived(game, chessFor(game));
    this.persistAndEmit(game);
    this.resumeBot(game);
    return game;
  }

  async restart(id: string): Promise<GameState> {
    const game = this.requireGame(id);
    for (const move of game.moves) await this.coach.cancel(move.id);
    game.moves = []; game.analysis = {}; game.coaching = {};
    game.branchId = randomUUID(); game.revision += 1; game.paused = false;
    this.refreshDerived(game, new Chess());
    this.persistAndEmit(game);
    if (game.settings.mode === "bot" && botColor(game) === "white") this.track(this.scheduleBot(game));
    return game;
  }

  async delete(id: string): Promise<void> {
    const game = this.requireGame(id);
    for (const move of game.moves) await this.coach.cancel(move.id);
    this.games.delete(id);
    if (!this.storage.deleteGame(id)) throw new ServiceError(404, "Game not found.");
    this.emit({ type: "game.deleted", gameId: id });
  }

  async deleteAll(): Promise<number> {
    const ids = this.storage.listGames().map((game) => game.id);
    for (const id of ids) {
      const game = this.get(id);
      if (game) for (const move of game.moves) await this.coach.cancel(move.id);
    }
    this.games.clear();
    const deleted = this.storage.deleteAllGames();
    for (const gameId of ids) this.emit({ type: "game.deleted", gameId });
    return deleted;
  }

  resign(id: string, color?: "white" | "black"): GameState {
    const game = this.requireGame(id);
    if (game.status !== "active") throw new ServiceError(409, "This game has ended.");
    const resigning = color ?? game.turn;
    game.status = "complete"; game.result = resigning === "white" ? "0-1" : "1-0";
    game.resultReason = `${resigning} resigned`; game.paused = false; game.revision += 1;
    this.persistAndEmit(game); this.scheduleRecheck(game); return game;
  }

  agreeDraw(id: string): GameState {
    const game = this.requireGame(id);
    if (game.status !== "active") throw new ServiceError(409, "This game has ended.");
    if (game.settings.mode !== "local") throw new ServiceError(409, "Draw by agreement is available only in two-player games.");
    game.status = "complete"; game.result = "1/2-1/2"; game.resultReason = "draw by agreement";
    game.paused = false; game.revision += 1; this.persistAndEmit(game); this.scheduleRecheck(game); return game;
  }

  async ask(id: string, moveId: string, question: string): Promise<string> {
    const game = this.requireGame(id);
    const move = game.moves.find((item) => item.id === moveId);
    if (!move) throw new ServiceError(404, "That move is no longer part of this game.");
    if (game.settings.mode === "bot" && move.mover === botColor(game)) throw new ServiceError(409, "AI coaching is only available for human moves.");
    const analysis = game.analysis[moveId];
    if (!analysis) throw new ServiceError(409, "Analysis is not ready yet.");
    await this.coach.refresh?.();
    this.announceProvider();
    if (!this.coach.status().available) throw new ServiceError(503, this.coach.status().error ?? "Coaching is unavailable.");
    const openingAtMove = recognizeOpening(game.moves.slice(0, move.ply).map((item) => item.san));
    const answer = await this.coach.followUp({ ...game, opening: openingAtMove }, move, analysis, question.slice(0, 500))
      .finally(() => this.announceProvider());
    const record = game.coaching[moveId] ?? { moveId, status: "complete" };
    record.followups = [...(record.followups ?? []), { question: question.slice(0, 500), answer, createdAt: now() }];
    game.coaching[moveId] = record;
    this.storage.saveGame(game);
    this.emit({ type: "coaching.updated", gameId: id, moveId, coaching: record });
    return answer;
  }

  review(id: string, throughPly: number, moves: Array<{ from: string; to: string; promotion?: string }>): { fen: string; sans: string[]; legalMoves: GameState["legalMoves"] } {
    const game = this.requireGame(id);
    if (throughPly < 0 || throughPly > game.moves.length) throw new ServiceError(400, "Invalid review position.");
    const chess = chessFor(game, throughPly);
    const sans: string[] = [];
    for (const move of moves.slice(0, 20)) {
      try { sans.push(chess.move(move).san); } catch { throw new ServiceError(400, "That review line contains an illegal move."); }
    }
    return { fen: chess.fen(), sans, legalMoves: legalMoves(chess) };
  }

  postgameSummary(id: string): { keyMoments: string[]; lessons: string[]; missing: number } {
    const game = this.requireGame(id);
    const completed = game.moves.map((move) => ({ move, analysis: game.analysis[move.id] })).filter((item) => item.analysis?.status === "complete");
    const keyMoments = completed
      .filter((item) => item.analysis.verdict !== "Good move")
      .sort((a, b) => moveWinChanceLoss(b) - moveWinChanceLoss(a))
      .slice(0, 3)
      .map((item) => `${item.move.ply}. ${item.move.san}: ${item.analysis.verdict === "Blunder" ? "This move badly damaged the position" : item.analysis.verdict === "Mistake" ? "This move made the position much harder" : "This move could be improved"}`);
    const lessons = keyMoments.length
      ? ["At each critical turn, scan checks, captures, and threats before choosing a move.", "Review the alternatives on a separate board; the recorded game will not change."]
      : ["Development and king safety were the main practical themes."];
    return { keyMoments: keyMoments.length ? keyMoments : ["No major engine swing was recorded."], lessons, missing: game.moves.length - completed.length };
  }

  private isCurrentMove(game: GameState, move: MoveRecord): boolean {
    return game.branchId === move.branchId && game.moves.some((item) => item.id === move.id && item.revision === move.revision);
  }

  private track(task: Promise<unknown>): void {
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
  }

  async idle(): Promise<void> {
    while (this.tasks.size || this.coachingChains.size) {
      if (this.tasks.size) await Promise.allSettled([...this.tasks]);
      if (this.coachingChains.size) await Promise.allSettled([...this.coachingChains.values()]);
    }
  }

  private refreshDerived(game: GameState, chess: Chess): void {
    game.fen = chess.fen(); game.turn = playerForTurn(chess.turn());
    const outcome = resultFor(chess); game.status = outcome.status; game.result = outcome.result; game.resultReason = outcome.reason;
    game.legalMoves = legalMoves(chess); game.pgn = chess.pgn();
    const recognized = recognizeOpening(game.moves.map((move) => move.san));
    if (recognized) game.opening = recognized;
    else game.opening = undefined;
    game.updatedAt = now();
  }

  private persistAndEmit(game: GameState): void {
    game.updatedAt = now(); this.storage.saveGame(game); this.emit({ type: "game.updated", game });
  }

  private requireGame(id: string): GameState {
    const game = this.get(id); if (!game) throw new ServiceError(404, "Game not found."); return game;
  }
}

export class ServiceError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}
