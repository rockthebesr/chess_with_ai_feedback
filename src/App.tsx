import { useEffect, useState } from "react";
import type { GameSettings, GameState, GameSummary, ProviderStatus, ServerEvent } from "../shared/types";
import { api, connectEvents } from "./api";
import { GameRoom } from "./GameRoom";
import { Home } from "./Home";

function gameIdFromPath(): string | undefined {
  return location.pathname.match(/^\/games\/([0-9a-f-]+)\/?$/i)?.[1];
}

function gamePath(id: string): string { return `/games/${id}`; }

export function App() {
  const [game, setGame] = useState<GameState>();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [provider, setProvider] = useState<ProviderStatus>({ available: false, error: "Checking coaching…" });
  const [stockfish, setStockfish] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const refreshLibrary = () => api.bootstrap().then((data) => { setGames(data.games); setProvider(data.provider); setStockfish(data.stockfish.available); });
  useEffect(() => {
    let active = true;
    const loadLocation = async () => {
      const id = gameIdFromPath();
      if (!id) { if (active) setGame(undefined); return; }
      try { const loaded = await api.game(id); if (active) setGame(loaded); }
      catch (e) {
        if (active) { setGame(undefined); setError(e instanceof Error ? e.message : "That game could not be opened."); history.replaceState({}, "", "/"); }
      }
    };
    void refreshLibrary().then(loadLocation).catch((e) => setError(e.message)).finally(() => setLoading(false));
    const onPopState = () => void loadLocation();
    addEventListener("popstate", onPopState);
    const disconnect = connectEvents((event: ServerEvent) => {
      if (event.type === "provider.updated") setProvider(event.provider);
      if (event.type === "game.updated") { setGame((current) => current?.id === event.game.id ? event.game : current); void refreshLibrary(); }
      if (event.type === "game.deleted") {
        setGame((current) => { if (current?.id !== event.gameId) return current; history.replaceState({}, "", "/"); return undefined; });
        void refreshLibrary();
      }
      if (event.type === "analysis.updated") setGame((current) => current?.id === event.gameId ? { ...current, analysis: { ...current.analysis, [event.moveId]: event.analysis } } : current);
      if (event.type === "coaching.updated") setGame((current) => current?.id === event.gameId ? { ...current, coaching: { ...current.coaching, [event.moveId]: event.coaching } } : current);
    });
    return () => { active = false; removeEventListener("popstate", onPopState); disconnect(); };
  }, []);

  const run = async (work: () => Promise<GameState>) => {
    setError(undefined);
    try { const next = await work(); setGame(next); history.pushState({}, "", gamePath(next.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
  };
  const goHome = () => { setGame(undefined); setError(undefined); history.pushState({}, "", "/"); void refreshLibrary(); };
  const deleteGame = async (id: string) => {
    if (!confirm("Delete this saved game? This cannot be undone.")) return;
    setError(undefined);
    try { await api.deleteGame(id); await refreshLibrary(); }
    catch (e) { setError(e instanceof Error ? e.message : "The game could not be deleted."); }
  };
  const deleteAllGames = async () => {
    if (!confirm("Delete every saved game? This cannot be undone.")) return;
    setError(undefined);
    try { await api.deleteAllGames(); goHome(); }
    catch (e) { setError(e instanceof Error ? e.message : "The saved games could not be deleted."); }
  };
  if (loading) return <main className="center"><div className="spinner" />Opening your chess room…</main>;
  if (!game) return <Home games={games} provider={provider} stockfish={stockfish} error={error}
    onCreate={(settings) => run(() => api.create(settings))}
    onResume={(id) => run(() => api.game(id))} onDelete={(id) => void deleteGame(id)} onDeleteAll={() => void deleteAllGames()} />;
  return <GameRoom game={game} provider={provider} stockfish={stockfish} error={error} setError={setError}
    onGame={setGame} onHome={goHome} />;
}
