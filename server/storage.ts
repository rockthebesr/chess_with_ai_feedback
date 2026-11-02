import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameState, GameSummary } from "../shared/types.js";

export function defaultDataDir(): string {
  if (process.env.CHESS_COACH_DATA_DIR) return process.env.CHESS_COACH_DATA_DIR;
  return path.join(os.homedir(), "Library", "Application Support", "Local Chess Coach");
}

export class Storage {
  readonly dataDir: string;
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(dataDir = defaultDataDir()) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.databasePath = path.join(dataDir, "chess-coach.sqlite");
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate();
    this.recoverPending();
  }

  private migrate(): void {
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY, status TEXT NOT NULL, mode TEXT NOT NULL,
          white_name TEXT NOT NULL, black_name TEXT NOT NULL, result TEXT NOT NULL,
          move_count INTEGER NOT NULL, state_json TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS moves (
          id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL, revision INTEGER NOT NULL, ply INTEGER NOT NULL,
          san TEXT NOT NULL, uci TEXT NOT NULL, before_fen TEXT NOT NULL, after_fen TEXT NOT NULL,
          mover TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS analysis (
          move_id TEXT PRIMARY KEY REFERENCES moves(id) ON DELETE CASCADE,
          status TEXT NOT NULL, payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS coaching (
          move_id TEXT PRIMARY KEY REFERENCES moves(id) ON DELETE CASCADE,
          status TEXT NOT NULL, payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS games_updated_idx ON games(updated_at DESC);
        CREATE INDEX IF NOT EXISTS moves_game_idx ON moves(game_id, ply);
        PRAGMA user_version=1;
      `);
    }
  }

  private recoverPending(): void {
    const rows = this.db.prepare("SELECT id, state_json FROM games").all() as Array<{ id: string; state_json: string }>;
    for (const row of rows) {
      const game = JSON.parse(row.state_json) as GameState;
      let changed = false;
      for (const record of Object.values(game.analysis)) {
        if (record.status === "pending") { record.status = "unavailable"; record.note = "Analysis was interrupted by an app restart."; changed = true; }
      }
      for (const record of Object.values(game.coaching)) {
        if (record.status === "queued" || record.status === "streaming") {
          record.status = "unavailable"; record.error = "Coaching was interrupted by an app restart."; delete record.streamedText; changed = true;
        }
      }
      if (changed) this.saveGame(game);
    }
  }

  saveGame(game: GameState): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO games
        (id,status,mode,white_name,black_name,result,move_count,state_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, mode=excluded.mode,
        white_name=excluded.white_name, black_name=excluded.black_name, result=excluded.result,
        move_count=excluded.move_count, state_json=excluded.state_json, updated_at=excluded.updated_at`)
        .run(game.id, game.status, game.settings.mode, game.settings.whiteName, game.settings.blackName,
          game.result, game.moves.length, JSON.stringify(game), game.createdAt, game.updatedAt);
      this.db.prepare("DELETE FROM moves WHERE game_id = ?").run(game.id);
      const insertMove = this.db.prepare(`INSERT INTO moves
        (id,game_id,branch_id,revision,ply,san,uci,before_fen,after_fen,mover,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      const insertAnalysis = this.db.prepare("INSERT INTO analysis (move_id,status,payload_json) VALUES (?,?,?)");
      const insertCoaching = this.db.prepare("INSERT INTO coaching (move_id,status,payload_json) VALUES (?,?,?)");
      for (const move of game.moves) {
        insertMove.run(move.id, move.gameId, move.branchId, move.revision, move.ply, move.san, move.uci,
          move.beforeFen, move.afterFen, move.mover, move.createdAt);
        const analysis = game.analysis[move.id];
        if (analysis) insertAnalysis.run(move.id, analysis.status, JSON.stringify(analysis));
        const coaching = game.coaching[move.id];
        if (coaching && coaching.status !== "streaming") insertCoaching.run(move.id, coaching.status, JSON.stringify(coaching));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  loadGame(id: string): GameState | undefined {
    const row = this.db.prepare("SELECT state_json FROM games WHERE id = ?").get(id) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) as GameState : undefined;
  }

  listGames(): GameSummary[] {
    return (this.db.prepare(`SELECT id,white_name,black_name,mode,status,result,move_count,updated_at
      FROM games ORDER BY updated_at DESC`).all() as Array<Record<string, string | number>>).map((row) => ({
        id: String(row.id), whiteName: String(row.white_name), blackName: String(row.black_name),
        mode: row.mode as GameSummary["mode"], status: row.status as GameSummary["status"],
        result: String(row.result), moveCount: Number(row.move_count), updatedAt: String(row.updated_at),
      }));
  }

  deleteGame(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM games WHERE id = ?").run(id).changes) > 0;
  }

  deleteAllGames(): number {
    return Number(this.db.prepare("DELETE FROM games").run().changes);
  }

  close(): void { this.db.close(); }
}
