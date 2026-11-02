import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WebSocketServer } from "ws";
import type { ServerEvent } from "../shared/types.js";
import { CodexCoachProvider } from "./coach.js";
import { OllamaCoachProvider, PreferredCoachProvider } from "./local-coach.js";
import { GameService, ServiceError } from "./game-service.js";
import { Storage } from "./storage.js";
import { findStockfish, UciEngine } from "./uci.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const storage = new Storage();
const runtimeDir = path.join(storage.dataDir, "coach-runtime");
const { mkdirSync } = await import("node:fs");
mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

const stockfishPath = await findStockfish();
const analysisEngine = stockfishPath ? new UciEngine(stockfishPath, "analysis") : undefined;
const botEngine = stockfishPath ? new UciEngine(stockfishPath, "bot") : undefined;
const coach = new PreferredCoachProvider(new OllamaCoachProvider(), new CodexCoachProvider(runtimeDir));
const sockets = new Set<import("ws").WebSocket>();
const broadcast = (event: ServerEvent) => {
  const payload = JSON.stringify(event);
  for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(payload);
};
const games = new GameService(storage, coach, analysisEngine, botEngine, broadcast);

const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`, `http://localhost:${port}`,
  "http://127.0.0.1:5173", "http://localhost:5173",
]);

function validateOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

async function body(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new ServiceError(413, "Request is too large.");
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new ServiceError(400, "Request body must be valid JSON."); }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  res.end(payload);
}

const settingsSchema = z.object({
  mode: z.enum(["bot", "local"]).optional(), whiteName: z.string().max(40).optional(), blackName: z.string().max(40).optional(),
  humanColor: z.enum(["white", "black"]).optional(), difficulty: z.enum(["beginner", "easy", "medium", "strong"]).optional(),
  practice: z.enum(["normal", "guided"]).optional(), autoFlip: z.boolean().optional(), hintsVisible: z.boolean().optional(),
  boardTheme: z.enum(["forest", "walnut", "slate", "contrast"]).optional(),
  pieceStyle: z.enum(["classic", "solid", "letters"]).optional(),
});
const moveSchema = z.object({ from: z.string().regex(/^[a-h][1-8]$/), to: z.string().regex(/^[a-h][1-8]$/), promotion: z.enum(["q", "r", "b", "n"]).optional(), expectedRevision: z.number().int().nonnegative() });

const server = createServer(async (req, res) => {
  try {
    if (!validateOrigin(req)) throw new ServiceError(403, "Origin is not allowed.");
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, stockfish: Boolean(stockfishPath), coaching: games.providerStatus(), dataPath: storage.databasePath });
    }
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      return json(res, 200, { games: games.list(), provider: games.providerStatus(), stockfish: { available: Boolean(stockfishPath), path: stockfishPath ? "configured" : undefined } });
    }
    if (req.method === "POST" && url.pathname === "/api/games") {
      return json(res, 201, games.create(settingsSchema.parse(await body(req))));
    }
    if (req.method === "DELETE" && url.pathname === "/api/games") {
      return json(res, 200, { deleted: await games.deleteAll() });
    }
    if (parts[0] === "api" && parts[1] === "games" && parts[2]) {
      const gameId = parts[2];
      if (req.method === "GET" && parts.length === 3) {
        const game = games.get(gameId); if (!game) throw new ServiceError(404, "Game not found."); return json(res, 200, game);
      }
      if (req.method === "DELETE" && parts.length === 3) {
        await games.delete(gameId); return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && parts[3] === "moves") return json(res, 200, await games.move(gameId, moveSchema.parse(await body(req))));
      if (req.method === "POST" && parts[3] === "continue") {
        const input = z.object({ expectedRevision: z.number().int().nonnegative() }).parse(await body(req));
        return json(res, 200, await games.continue(gameId, input.expectedRevision));
      }
      if (req.method === "POST" && parts[3] === "undo") return json(res, 200, await games.undo(gameId));
      if (req.method === "POST" && parts[3] === "restart") return json(res, 200, await games.restart(gameId));
      if (req.method === "POST" && parts[3] === "resign") {
        const input = z.object({ color: z.enum(["white", "black"]).optional() }).parse(await body(req));
        return json(res, 200, games.resign(gameId, input.color));
      }
      if (req.method === "POST" && parts[3] === "draw") return json(res, 200, games.agreeDraw(gameId));
      if (req.method === "POST" && parts[3] === "questions") {
        const input = z.object({ moveId: z.string().uuid(), question: z.string().min(1).max(500) }).parse(await body(req));
        return json(res, 200, { answer: await games.ask(gameId, input.moveId, input.question) });
      }
      if (req.method === "POST" && parts[3] === "review") {
        const input = z.object({ throughPly: z.number().int().nonnegative(), moves: z.array(z.object({ from: z.string(), to: z.string(), promotion: z.string().optional() })).max(20) }).parse(await body(req));
        return json(res, 200, games.review(gameId, input.throughPly, input.moves));
      }
      if (req.method === "GET" && parts[3] === "practice" && parts.length === 4) return json(res, 200, games.practicePositions(gameId));
      if (req.method === "POST" && parts[3] === "practice" && parts[4]) {
        const { expectedRevision: _unused, ...attempt } = moveSchema.extend({ expectedRevision: z.number().optional() }).parse(await body(req));
        return json(res, 200, await games.practiceAttempt(gameId, parts[4], attempt));
      }
      if (req.method === "GET" && parts[3] === "summary") return json(res, 200, games.postgameSummary(gameId));
      if (req.method === "GET" && parts[3] === "pgn") {
        const game = games.get(gameId); if (!game) throw new ServiceError(404, "Game not found.");
        const headers = `[Event "Local Chess Coach"]\n[White "${game.settings.whiteName.replaceAll('"', "'")}"]\n[Black "${game.settings.blackName.replaceAll('"', "'")}"]\n[Result "${game.result}"]\n\n`;
        const movetext = game.pgn.replace(/^\[[\s\S]*?\]\s*/gm, "").trim()
          .replace(/\s+(?:1-0|0-1|1\/2-1\/2|\*)\s*$/, "").trim();
        const payload = `${headers}${movetext}${movetext ? " " : ""}${game.result}\n`;
        res.writeHead(200, { "content-type": "application/x-chess-pgn; charset=utf-8", "content-disposition": `attachment; filename="game-${game.id.slice(0, 8)}.pgn"` });
        return res.end(payload);
      }
    }
    if (req.method === "GET" && process.env.NODE_ENV === "production" && existsSync(dist)) {
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      let file = path.resolve(dist, requested);
      if (!file.startsWith(`${dist}${path.sep}`) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, "index.html");
      const ext = path.extname(file);
      const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8` }); return createReadStream(file).pipe(res);
    }
    json(res, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof z.ZodError) return json(res, 400, { error: "Invalid request.", details: error.issues });
    const status = error instanceof ServiceError ? error.statusCode : 500;
    json(res, status, { error: error instanceof Error ? error.message : "Unexpected error." });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/events" || !validateOrigin(req)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });

server.listen(port, host, () => {
  console.log(`Local Chess Coach: http://${host}:${port}`);
  console.log(stockfishPath ? "Stockfish found." : "Stockfish not found; rules fallback is active.");
  void coach.initialize().then((provider) => broadcast({ type: "provider.updated", provider }));
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  coach.close(); analysisEngine?.stop(); botEngine?.stop(); storage.close();
  for (const socket of sockets) socket.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
