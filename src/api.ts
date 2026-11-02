import type { GameSettings, GameState, GameSummary, ProviderStatus, ServerEvent } from "../shared/types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options?.body ? { "content-type": "application/json", ...options.headers } : options?.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

export const api = {
  bootstrap: () => request<{ games: GameSummary[]; provider: ProviderStatus; stockfish: { available: boolean } }>("/api/bootstrap"),
  create: (settings: GameSettings) => request<GameState>("/api/games", { method: "POST", body: JSON.stringify(settings) }),
  game: (id: string) => request<GameState>(`/api/games/${id}`),
  deleteGame: (id: string) => request<{ ok: true }>(`/api/games/${id}`, { method: "DELETE" }),
  deleteAllGames: () => request<{ deleted: number }>("/api/games", { method: "DELETE" }),
  move: (id: string, move: { from: string; to: string; promotion?: string; expectedRevision: number }) =>
    request<GameState>(`/api/games/${id}/moves`, { method: "POST", body: JSON.stringify(move) }),
  action: (id: string, action: "undo" | "restart" | "draw", payload = {}) =>
    request<GameState>(`/api/games/${id}/${action}`, { method: "POST", body: JSON.stringify(payload) }),
  continue: (id: string, expectedRevision: number) =>
    request<GameState>(`/api/games/${id}/continue`, { method: "POST", body: JSON.stringify({ expectedRevision }) }),
  resign: (id: string, color: "white" | "black") =>
    request<GameState>(`/api/games/${id}/resign`, { method: "POST", body: JSON.stringify({ color }) }),
  ask: (id: string, moveId: string, question: string) =>
    request<{ answer: string }>(`/api/games/${id}/questions`, { method: "POST", body: JSON.stringify({ moveId, question }) }),
  summary: (id: string) => request<{ keyMoments: string[]; lessons: string[]; missing: number }>(`/api/games/${id}/summary`),
};

export function connectEvents(onEvent: (event: ServerEvent) => void): () => void {
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: number | undefined;
  const connect = () => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${protocol}://${location.host}/events`);
    socket.onmessage = (message) => {
      try { onEvent(JSON.parse(message.data) as ServerEvent); } catch { /* ignore malformed event */ }
    };
    socket.onclose = () => { if (!stopped) retry = window.setTimeout(connect, 1200); };
  };
  connect();
  return () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(); };
}
