import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export interface UciLine {
  multipv: number;
  depth: number;
  cp?: number;
  mate?: number;
  moves: string[];
}

export interface UciResult {
  bestMove: string;
  lines: UciLine[];
}

export async function findStockfish(): Promise<string | undefined> {
  const candidates = [
    process.env.STOCKFISH_PATH,
    "/opt/homebrew/bin/stockfish",
    "/usr/local/bin/stockfish",
    "/usr/bin/stockfish",
  ].filter((value): value is string => Boolean(value));
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export class UciEngine {
  private proc?: ChildProcessWithoutNullStreams;
  private lines?: readline.Interface;
  private listeners = new Set<(line: string) => void>();
  private chain = Promise.resolve<unknown>(undefined);
  private ready = false;
  version = "Stockfish";

  constructor(
    private readonly executable: string,
    private readonly label: string,
  ) {}

  async start(): Promise<void> {
    if (this.ready) return;
    this.proc = spawn(this.executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.lines.on("line", (line) => {
      if (line.startsWith("id name ")) this.version = line.slice(8).trim();
      for (const listener of this.listeners) listener(line);
    });
    this.proc.on("exit", () => {
      this.ready = false;
    });
    this.send("uci");
    await this.waitFor("uciok", 5000);
    this.send("setoption name Threads value 1");
    this.send("setoption name Hash value 32");
    this.send("isready");
    await this.waitFor("readyok", 5000);
    this.ready = true;
  }

  private send(command: string): void {
    if (!this.proc?.stdin.writable) throw new Error(`${this.label} engine is not running`);
    this.proc.stdin.write(`${command}\n`);
  }

  private waitFor(expected: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${expected}`));
      }, timeoutMs);
      const onLine = (line: string) => {
        if (line === expected || line.startsWith(`${expected} `)) {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(onLine);
      };
      this.listeners.add(onLine);
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work, work);
    this.chain = result.catch(() => undefined);
    return result;
  }

  analyze(fen: string, movetimeMs: number, multiPv = 1, skill?: number): Promise<UciResult> {
    return this.enqueue(async () => {
      await this.start();
      this.send("stop");
      this.send(`setoption name MultiPV value ${Math.max(1, Math.min(3, multiPv))}`);
      if (skill !== undefined) this.send(`setoption name Skill Level value ${Math.max(0, Math.min(20, skill))}`);
      const found = new Map<number, UciLine>();
      return await new Promise<UciResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.send("stop");
          cleanup();
          reject(new Error("Stockfish analysis timed out"));
        }, movetimeMs + 5000);
        const onLine = (line: string) => {
          if (line.startsWith("info ") && line.includes(" pv ") && line.includes(" score ")) {
            const parsed = parseInfo(line);
            if (parsed) found.set(parsed.multipv, parsed);
          }
          if (line.startsWith("bestmove ")) {
            cleanup();
            const bestMove = line.split(/\s+/)[1];
            resolve({ bestMove, lines: [...found.values()].sort((a, b) => a.multipv - b.multipv) });
          }
        };
        const cleanup = () => {
          clearTimeout(timeout);
          this.listeners.delete(onLine);
        };
        this.listeners.add(onLine);
        this.send(`position fen ${fen}`);
        this.send(`go movetime ${Math.max(50, movetimeMs)}`);
      });
    });
  }

  stop(): void {
    try {
      this.send("quit");
    } catch {
      /* already gone */
    }
    this.lines?.close();
    this.proc?.kill();
    this.ready = false;
  }
}

export function parseInfo(line: string): UciLine | undefined {
  const tokens = line.trim().split(/\s+/);
  const at = (name: string) => tokens.indexOf(name);
  const depthAt = at("depth");
  const pvAt = at("pv");
  const scoreAt = at("score");
  if (depthAt < 0 || pvAt < 0 || scoreAt < 0 || !tokens[pvAt + 1]) return undefined;
  const type = tokens[scoreAt + 1];
  const value = Number(tokens[scoreAt + 2]);
  if (!Number.isFinite(value)) return undefined;
  const multipvAt = at("multipv");
  return {
    multipv: multipvAt >= 0 ? Number(tokens[multipvAt + 1]) : 1,
    depth: Number(tokens[depthAt + 1]) || 0,
    cp: type === "cp" ? value : undefined,
    mate: type === "mate" ? value : undefined,
    moves: tokens.slice(pvAt + 1),
  };
}
