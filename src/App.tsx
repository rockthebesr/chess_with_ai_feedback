import { Chess } from "chess.js";
import { useEffect, useState } from "react";
import type { CandidateLine, GameReviewSummary, GameSettings, GameState, GameSummary, PlayerPatterns, ProviderStatus, ServerEvent } from "../shared/types";
import { api, connectEvents } from "./api";
import { ChessBoard } from "./ChessBoard";
import { GameReview, moveLabel } from "./GameReview";
import { PracticePanel, type PracticeState } from "./Practice";

const initialSettings: GameSettings = {
  mode: "bot", whiteName: "Rock", blackName: "Christine", humanColor: "white",
  difficulty: "easy", practice: "normal", autoFlip: false, hintsVisible: false,
  boardTheme: "forest", pieceStyle: "classic",
};

function gameIdFromPath(): string | undefined {
  return location.pathname.match(/^\/games\/([0-9a-f-]+)\/?$/i)?.[1];
}

function gamePath(id: string): string { return `/games/${id}`; }

function appearanceFor(game: GameState): Pick<GameSettings, "boardTheme" | "pieceStyle"> {
  try {
    const saved = JSON.parse(localStorage.getItem("chess-coach-appearance") ?? "{}") as Partial<GameSettings>;
    return { boardTheme: saved.boardTheme ?? game.settings.boardTheme ?? "forest", pieceStyle: saved.pieceStyle ?? game.settings.pieceStyle ?? "classic" };
  } catch { return { boardTheme: game.settings.boardTheme ?? "forest", pieceStyle: game.settings.pieceStyle ?? "classic" }; }
}

function rememberAppearance(boardTheme: GameSettings["boardTheme"], pieceStyle: GameSettings["pieceStyle"]): void {
  localStorage.setItem("chess-coach-appearance", JSON.stringify({ boardTheme, pieceStyle }));
}

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

function Home({ games, provider, stockfish, error, onCreate, onResume, onDelete, onDeleteAll }: {
  games: GameSummary[]; provider: ProviderStatus; stockfish: boolean; error?: string;
  onCreate: (settings: GameSettings) => void; onResume: (id: string) => void; onDelete: (id: string) => void; onDeleteAll: () => void;
}) {
  const saved = localStorage.getItem("chess-coach-settings");
  const [settings, setSettings] = useState<GameSettings>(saved ? { ...initialSettings, ...JSON.parse(saved) } : initialSettings);
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => setSettings((old) => ({ ...old, [key]: value }));
  const start = () => { localStorage.setItem("chess-coach-settings", JSON.stringify(settings)); onCreate(settings); };
  const [patterns, setPatterns] = useState<PlayerPatterns[]>([]);
  useEffect(() => { void api.patterns().then(setPatterns).catch(() => setPatterns([])); }, [games.length]);
  return <main className="home-shell">
    <header className="hero"><span className="eyebrow">A quiet place to learn together</span><h1>Local Chess Coach</h1><p>Play a real game. Get a clear lesson after every move.</p></header>
    {error && <div className="alert">{error}</div>}
    <section className="home-grid">
      <div className="card setup-card"><h2>Start a game</h2>
        <div className="segmented"><button className={settings.mode === "bot" ? "active" : ""} onClick={() => update("mode", "bot")}>Play the coach bot</button><button className={settings.mode === "local" ? "active" : ""} onClick={() => update("mode", "local")}>Two people here</button></div>
        <div className="form-grid">
          <label>White player<input value={settings.whiteName} onChange={(e) => update("whiteName", e.target.value)} /></label>
          <label>Black player<input value={settings.blackName} disabled={settings.mode === "bot"} onChange={(e) => update("blackName", e.target.value)} /></label>
          {settings.mode === "bot" && <><label>Your color<select value={settings.humanColor} onChange={(e) => update("humanColor", e.target.value as GameSettings["humanColor"])}><option value="white">White</option><option value="black">Black</option></select></label>
          <label>Bot level<select value={settings.difficulty} onChange={(e) => update("difficulty", e.target.value as GameSettings["difficulty"])}><option value="beginner">Beginner</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="strong">Strong</option></select></label></>}
          <label>Learning pace<select value={settings.practice} onChange={(e) => update("practice", e.target.value as GameSettings["practice"])}><option value="normal">Normal — keep playing</option><option value="guided">Guided — pause after moves</option></select></label>
          <label>Board colors<select value={settings.boardTheme} onChange={(e) => update("boardTheme", e.target.value as GameSettings["boardTheme"])}><option value="forest">Forest green</option><option value="walnut">Warm walnut</option><option value="slate">Cool slate</option><option value="contrast">High contrast</option></select></label>
          <label>Pieces<select value={settings.pieceStyle} onChange={(e) => update("pieceStyle", e.target.value as GameSettings["pieceStyle"])}><option value="classic">Classic outline</option><option value="solid">Solid silhouettes</option><option value="letters">Letter tokens</option></select></label>
        </div>
        <label className="check-row"><input type="checkbox" checked={settings.autoFlip} onChange={(e) => update("autoFlip", e.target.checked)} />Flip the board after each turn</label>
        <label className="check-row"><input type="checkbox" checked={settings.hintsVisible} onChange={(e) => update("hintsVisible", e.target.checked)} /><span>Show engine suggestion lines during the game <small>Both players can open suggested continuations before the game ends.</small></span></label>
        <button className="primary big" onClick={start}>Set up the board <span>→</span></button>
      </div>
      <aside className="side-stack">
        <div className="card status-card"><h3>Ready check</h3><StatusDot ok={provider.available} label={provider.available ? `${provider.authMode === "local" ? "Local coaching" : "ChatGPT coaching"} · ${provider.planType ?? "ready"}` : "Coaching fallback"} detail={provider.available ? provider.model : provider.error} />
          <StatusDot ok={stockfish} label={stockfish ? "Stockfish analysis" : "Rules-based analysis"} detail={stockfish ? "Local engine ready" : "Install Stockfish for deeper feedback"} /></div>
        <div className="card saved"><div className="saved-heading"><h3>Saved games</h3>{games.length > 0 && <button className="saved-delete-all" onClick={onDeleteAll}>Delete all</button>}</div>{games.length === 0 ? <p className="muted">Your games will appear here automatically.</p> : games.slice(0, 8).map((item) => <div className="saved-row" key={item.id}><button className="saved-open" onClick={() => onResume(item.id)}><span><strong>{item.whiteName} vs {item.blackName}</strong><small>{item.moveCount} moves · {item.status === "active" ? "In progress" : item.result}</small></span><span>›</span></button><button className="saved-delete" aria-label={`Delete ${item.whiteName} versus ${item.blackName}`} title="Delete saved game" onClick={() => onDelete(item.id)}>Delete</button></div>)}</div>
        <PatternsCard players={patterns} />
      </aside>
    </section>
  </main>;
}

// Too few mistakes make a percentage look more meaningful than it is.
const MIN_MISTAKES_FOR_PATTERNS = 3;

function PatternsCard({ players }: { players: PlayerPatterns[] }) {
  const ready = players.filter((player) => player.mistakes >= MIN_MISTAKES_FOR_PATTERNS);
  return <div className="card patterns"><h3>Mistake patterns</h3>
    {!ready.length && <p className="muted">Finish a few games and your most common mistakes will appear here.</p>}
    {ready.map((player) => <div className="pattern-player" key={player.name}>
      <strong>{player.name}</strong><small>{player.mistakes} mistakes across {player.games} {player.games === 1 ? "game" : "games"}</small>
      <ul>{player.patterns.slice(0, 4).map((pattern) => <li key={pattern.id}><span>{pattern.label}</span><b>{pattern.share}%</b><i style={{ width: `${pattern.share}%` }} /></li>)}</ul>
      <p className="pattern-advice">{player.patterns[0].advice}</p>
    </div>)}
  </div>;
}

function StatusDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return <div className="status-row"><i className={ok ? "ok" : "warn"} /><span><strong>{label}</strong><small>{detail}</small></span></div>;
}

function GameRoom({ game, provider, stockfish, error, setError, onGame, onHome }: {
  game: GameState; provider: ProviderStatus; stockfish: boolean; error?: string; setError: (value?: string) => void;
  onGame: (game: GameState) => void; onHome: () => void;
}) {
  const initialOrientation = game.settings.mode === "bot" ? game.settings.humanColor : "white";
  const [manualOrientation, setManualOrientation] = useState<"white" | "black">(initialOrientation);
  const [review, setReview] = useState<{ fen: string; legalMoves: GameState["legalMoves"]; label: string; ply?: number; lastMove?: { from: string; to: string } }>();
  const [summary, setSummary] = useState<GameReviewSummary>();
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [practice, setPractice] = useState<PracticeState>();
  const [boardTheme, setBoardTheme] = useState(() => appearanceFor(game).boardTheme);
  const [pieceStyle, setPieceStyle] = useState(() => appearanceFor(game).pieceStyle);
  const orientation = practice ? practice.positions[practice.index].mover : manualOrientation;
  const last = game.moves.at(-1);
  const coachedMoves = game.settings.mode === "bot" ? game.moves.filter((move) => move.mover === game.settings.humanColor) : game.moves;
  const moveAllowed = game.status === "active" && !game.paused && !(game.settings.mode === "bot" && game.turn !== game.settings.humanColor);

  const update = async (work: Promise<GameState>) => { setError(undefined); try { onGame(await work); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); } };
  const makeMove = (from: string, to: string, promotion?: string) => void update(api.move(game.id, { from, to, promotion, expectedRevision: game.revision }));
  const reviewMove = (from: string, to: string, promotion?: string) => {
    if (!review) return;
    const chess = new Chess(review.fen);
    try { const moved = chess.move({ from, to, promotion }); setReview({ fen: chess.fen(), legalMoves: legalFor(chess), label: `${review.label} · ${moved.san}`, ply: review.ply, lastMove: { from: moved.from, to: moved.to } }); } catch { /* board already limits moves */ }
  };
  const startPractice = async () => {
    setError(undefined);
    try {
      const positions = await api.practice(game.id);
      if (!positions.length) return;
      setReview(undefined);
      setPractice({ positions, index: 0, fen: positions[0].fen, checking: false, revealed: false, solvedIds: [] });
    } catch (e) { setError(e instanceof Error ? e.message : "Practice could not start."); }
  };
  const showPractice = (index: number) => setPractice((current) => current && { ...current, index, fen: current.positions[index].fen, checking: false, result: undefined, revealed: false });
  const practiceMove = async (from: string, to: string, promotion?: string) => {
    if (!practice) return;
    const position = practice.positions[practice.index];
    const board = new Chess(position.fen);
    try { board.move({ from, to, promotion }); } catch { return; }
    setError(undefined);
    setPractice({ ...practice, fen: board.fen(), checking: true, result: undefined });
    try {
      const result = await api.practiceAttempt(game.id, position.moveId, { from, to, promotion });
      setPractice((current) => current && { ...current, checking: false, result, solvedIds: result.solved && !current.solvedIds.includes(position.moveId) ? [...current.solvedIds, position.moveId] : current.solvedIds });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That move could not be checked.");
      setPractice((current) => current && { ...current, fen: position.fen, checking: false });
    }
  };
  useEffect(() => { setPractice(undefined); }, [game.id, game.branchId]);
  const showPly = (ply: number) => {
    const target = Math.max(0, Math.min(game.moves.length, ply));
    const move = game.moves[target - 1];
    const fen = move?.afterFen ?? game.moves[0]?.beforeFen ?? new Chess().fen();
    setReview({ fen, legalMoves: legalFor(new Chess(fen)), label: move ? stepLabel(game, move) : "Starting position", ply: target, lastMove: move && { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) } });
  };
  useEffect(() => {
    if (game.status !== "complete" || practice) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, select, textarea")) return;
      const current = review?.ply ?? game.moves.length;
      const next = event.key === "ArrowLeft" ? current - 1 : event.key === "ArrowRight" ? current + 1 : event.key === "Home" ? 0 : event.key === "End" ? game.moves.length : undefined;
      if (next === undefined) return;
      event.preventDefault();
      showPly(next);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [game.status, game.moves, review?.ply, practice]);
  // Refetch as verdicts land: the last live analysis and the post-game recheck both arrive after the game ends.
  const verdicts = game.moves.map((move) => game.analysis[move.id]?.verdict).join();
  useEffect(() => {
    if (game.status !== "complete") return;
    let current = true;
    setSummaryFailed(false);
    api.summary(game.id).then((loaded) => { if (current) setSummary(loaded); }).catch(() => { if (current) setSummaryFailed(true); });
    return () => { current = false; };
  }, [game.status, game.id, verdicts, summaryAttempt]);
  useEffect(() => { if (game.settings.mode === "local" && game.settings.autoFlip) setManualOrientation(game.turn); }, [game.turn, game.settings.mode, game.settings.autoFlip]);
  useEffect(() => { const appearance = appearanceFor(game); setBoardTheme(appearance.boardTheme); setPieceStyle(appearance.pieceStyle); }, [game.id]);

  return <main className="game-shell">
    <header className="topbar"><button className="brand" onClick={onHome}>♞ <span>Local Chess Coach</span></button><div className="game-meta"><span>{game.settings.whiteName}</span><b>{game.result === "*" ? "vs" : game.result}</b><span>{game.settings.blackName}</span></div><button className="quiet" onClick={onHome}>All games</button></header>
    {error && <div className="alert floating">{error}<button onClick={() => setError(undefined)}>×</button></div>}
    <div className="play-layout">
      <section className="board-column">
        <Player name={orientation === "white" ? game.settings.blackName : game.settings.whiteName} color={orientation === "white" ? "black" : "white"} active={game.turn === (orientation === "white" ? "black" : "white") && game.status === "active"} />
        {practice
          ? <ChessBoard fen={practice.fen} orientation={orientation} legalMoves={legalFor(new Chess(practice.fen))} disabled={practice.checking || Boolean(practice.result)} theme={boardTheme} pieceStyle={pieceStyle} onMove={(from, to, promotion) => void practiceMove(from, to, promotion)} />
          : <ChessBoard fen={review?.fen ?? game.fen} orientation={orientation} legalMoves={review?.legalMoves ?? game.legalMoves} lastMove={review ? review.lastMove : last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : undefined} disabled={review ? false : !moveAllowed} theme={boardTheme} pieceStyle={pieceStyle} onMove={review ? reviewMove : makeMove} />}
        <Player name={orientation === "white" ? game.settings.whiteName : game.settings.blackName} color={orientation} active={game.turn === orientation && game.status === "active"} />
        {review && <div className="review-banner"><span><strong>Review board</strong> — {review.label}</span><button onClick={() => setReview(undefined)}>Return to game</button></div>}
        <div className="controls"><button onClick={() => setManualOrientation((value) => value === "white" ? "black" : "white")}>↻ Flip</button><button onClick={() => void update(api.action(game.id, "undo"))} disabled={!game.moves.length}>↶ Take back</button><button onClick={() => { if (confirm("Restart this game from the beginning?")) void update(api.action(game.id, "restart")); }}>Restart</button>{game.settings.mode === "local" && <button onClick={() => void update(api.action(game.id, "draw"))} disabled={game.status !== "active"}>Agree draw</button>}<details className="appearance-menu"><summary>Appearance</summary><div><label>Board<select aria-label="Board colors" value={boardTheme} onChange={(e) => { const value = e.target.value as GameSettings["boardTheme"]; setBoardTheme(value); rememberAppearance(value, pieceStyle); }}><option value="forest">Forest</option><option value="walnut">Walnut</option><option value="slate">Slate</option><option value="contrast">High contrast</option></select></label><label>Pieces<select aria-label="Piece style" value={pieceStyle} onChange={(e) => { const value = e.target.value as GameSettings["pieceStyle"]; setPieceStyle(value); rememberAppearance(boardTheme, value); }}><option value="classic">Classic</option><option value="solid">Solid</option><option value="letters">Letters</option></select></label></div></details><button className="danger" onClick={() => { if (confirm("Resign this game?")) void update(api.resign(game.id, game.turn)); }} disabled={game.status !== "active"}>Resign</button></div>
      </section>
      <aside className="coach-column">
        <section className="turn-card"><div><span className="eyebrow">{game.status === "active" ? "Current turn" : "Game over"}</span><h2>{game.status === "active" ? `${game.turn === "white" ? game.settings.whiteName : game.settings.blackName} to move` : `${game.result} · ${game.resultReason ?? "finished"}`}</h2></div><div className={`mode-pill ${game.settings.practice}`}>{game.settings.practice === "guided" ? "Guided practice" : "Normal play"}</div></section>
        {game.paused && <section className="pause-card"><span>Lesson pause</span><p>You can read the latest feedback now, or continue even if coaching is still arriving.</p><button className="primary" onClick={() => void update(api.continue(game.id, game.revision))}>Continue game →</button></section>}
        {game.opening ? <OpeningCard game={game} /> : game.moves.length > 1 && <section className="unknown-opening"><small>OPENING</small><strong>Outside the starter catalog</strong><p>The moves are legal, but this position has no supported name in the local opening set.</p></section>}
        {practice && <PracticePanel state={practice} onRetry={() => showPractice(practice.index)} onReveal={() => setPractice({ ...practice, revealed: true })} onNext={() => showPractice(practice.index + 1)} onExit={() => setPractice(undefined)} />}
        {game.status === "complete" && !practice && <Postgame game={game} summary={summary} summaryFailed={summaryFailed} onRetrySummary={() => setSummaryAttempt((value) => value + 1)} ply={review?.ply} practiceCount={coachedMoves.filter((move) => { const analysis = game.analysis[move.id]; return analysis?.status === "complete" && (analysis.verdict === "Mistake" || analysis.verdict === "Blunder"); }).length} onPractice={() => void startPractice()} onSelectPly={showPly} onReview={(fen, line) => setReview(reviewFromLine(fen, line))} />}
        <section className="moves-section"><div className="section-heading"><h2>{game.settings.mode === "bot" ? "Your coaching" : "Move-by-move coaching"}</h2><span>{coachedMoves.length} {coachedMoves.length === 1 ? "move" : "moves"}</span></div>
          {!coachedMoves.length && <div className="empty"><span>♙</span><h3>Your first lesson starts with your first move.</h3><p>Click or drag a piece. Legal destinations will light up.</p></div>}
          <div className="move-feed">{[...coachedMoves].reverse().map((move) => <MoveCard key={move.id} game={game} moveId={move.id} provider={provider} stockfish={stockfish} onReview={(line) => setReview(reviewFromLine(move.beforeFen, line))} />)}</div>
        </section>
      </aside>
    </div>
  </main>;
}

function stepLabel(game: GameState, move: GameState["moves"][number]): string {
  const analysis = game.analysis[move.id];
  const preferred = analysis?.alternatives[0]?.san[0];
  const marked = analysis?.verdict === "Inaccuracy" || analysis?.verdict === "Mistake" || analysis?.verdict === "Blunder";
  return `${moveLabel(move)}${marked ? ` · ${analysis.verdict}` : ""}${marked && preferred && preferred !== move.san ? ` · engine preferred ${preferred}` : ""}`;
}

function legalFor(chess: Chess): GameState["legalMoves"] { return chess.moves({ verbose: true }).map((move) => ({ from: move.from, to: move.to, promotion: move.promotion })); }
function reviewFromLine(fen: string, line?: CandidateLine) {
  const chess = new Chess(fen); const shown: string[] = [];
  if (line) for (const uci of line.uci) { try { shown.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san); } catch { break; } }
  return { fen: chess.fen(), legalMoves: legalFor(chess), label: shown.length ? shown.join(" ") : "Explore your own alternatives" };
}

function Player({ name, color, active }: { name: string; color: "white" | "black"; active: boolean }) { return <div className={`player ${active ? "active" : ""}`}><span className={`avatar ${color}`}>{name[0]?.toUpperCase() || "?"}</span><strong>{name}</strong>{active && <small>thinking</small>}</div>; }

function OpeningCard({ game }: { game: GameState }) {
  const opening = game.opening!;
  return <details className="opening-card" open><summary><span><small>OPENING · {opening.eco}</small><strong>{opening.current ? opening.name : `Last recognized: ${opening.name}`}</strong></span><span>⌄</span></summary><div className="opening-body">{!opening.current && <p className="outside">Now outside the stored line.</p>}{opening.guidanceAvailable ? <><div><b>White's plan</b><p>{opening.plansWhite}</p></div><div><b>Black's plan</b><p>{opening.plansBlack}</p></div><p className="tradeoff"><b>Tradeoff:</b> {opening.tradeoffs}</p></> : <p className="outside">The opening name is verified from the position book. Coaching will use the current board because no opening-specific plan is stored for this line.</p>}</div></details>;
}

function MoveCard({ game, moveId, provider, stockfish, onReview }: { game: GameState; moveId: string; provider: ProviderStatus; stockfish: boolean; onReview: (line?: CandidateLine) => void }) {
  const move = game.moves.find((item) => item.id === moveId)!;
  const analysis = game.analysis[moveId]; const coaching = game.coaching[moveId];
  const [expanded, setExpanded] = useState(false); const [question, setQuestion] = useState(""); const [asking, setAsking] = useState(false); const [askError, setAskError] = useState<string>();
  const canShow = game.status === "complete" || game.settings.hintsVisible;
  const coachingSkipped = game.settings.mode === "bot" && move.mover !== game.settings.humanColor;
  const ask = async () => { if (!question.trim()) return; setAsking(true); setAskError(undefined); try { await api.ask(game.id, move.id, question.trim()); setQuestion(""); } catch (e) { setAskError(e instanceof Error ? e.message : "Question failed."); } finally { setAsking(false); } };
  return <article className="move-card"><header><span className={`move-number ${move.mover}`}>{Math.ceil(move.ply / 2)}{move.mover === "black" ? "…" : "."}</span><div><strong>{move.san}</strong><small>{move.mover === "white" ? game.settings.whiteName : game.settings.blackName}</small></div><Verdict verdict={analysis?.verdict} pending={!analysis || analysis.status === "pending"} /></header>
    <div className="feedback">{coachingSkipped ? <p className={analysis?.status === "pending" ? "pending-line" : "bot-analysis"}>{analysis?.status === "pending" && <i />}{analysis?.status === "pending" ? "Analyzing the bot move locally…" : "Bot move — local engine analysis only. AI coaching is reserved for your moves."}</p> : coaching?.status === "streaming" || coaching?.status === "queued" ? <p className="pending-line"><i /> Coaching move {move.ply}…</p> : <><p>{coaching?.explanation ?? analysis?.note ?? "Your move is being reviewed."}</p>{coaching?.lesson && <p className="lesson"><span>Coaching point</span>{coaching.lesson}</p>}</>}</div>
    {analysis && <button className="disclosure" onClick={() => setExpanded(!expanded)}>{expanded ? "Hide" : "See"} engine details <span>{expanded ? "−" : "+"}</span></button>}
    {expanded && analysis && <div className="engine-details"><p>{analysis.engine} · {analysis.depth ? `depth ${analysis.depth}` : "fallback"}{analysis.rechecked ? " · rechecked after the game" : ""} · {analysis.lossCp === undefined ? "mate/uncertain score" : `${(analysis.lossCp / 100).toFixed(2)} pawn change`}</p>{analysis.alternatives.length > 0 && <div className="lines">{analysis.alternatives.map((line) => <button key={line.id} disabled={!canShow} title={!canShow ? "Live hints are hidden for both players." : undefined} onClick={() => onReview(line)}><b>{line.id}</b> {canShow ? line.san.join(" ") : "Available after the game"}</button>)}</div>}<button onClick={() => onReview()} disabled={!canShow}>Explore on review board</button></div>}
    {!coachingSkipped && <div className="question"><input aria-label={`Question about ${move.san}`} placeholder={provider.available ? "Ask about this move…" : "Coaching is offline"} disabled={!provider.available || asking} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} /><button disabled={!provider.available || asking || !question.trim()} onClick={() => void ask()}>Ask</button></div>}
    {!coachingSkipped && askError && <p className="mini-error">{askError}</p>}{!coachingSkipped && coaching?.followups?.map((item, index) => <div className="followup" key={index}><b>You asked:</b> {item.question}<p>{item.answer}</p></div>)}
    {(coaching?.status === "verified-fallback" || coaching?.status === "unavailable") && <small className="offline-note">Verified coaching summary · play remains available</small>}
    {!stockfish && analysis?.status === "unavailable" && <small className="offline-note">Install Stockfish for verified candidate lines</small>}
  </article>;
}

function Verdict({ verdict, pending }: { verdict?: string; pending: boolean }) {
  const friendly = verdict === "Good move" ? "Nice move" : verdict === "Inaccuracy" ? "Could be better" : verdict === "Mistake" ? "Not a good move" : verdict === "Blunder" ? "Serious mistake" : "Let's review";
  return <span className={`verdict ${pending ? "pending" : verdict?.toLowerCase().replaceAll(" ", "-")}`}>{pending ? "Thinking" : friendly}</span>;
}

function Postgame({ game, summary, summaryFailed, onRetrySummary, ply, practiceCount, onPractice, onSelectPly, onReview }: { game: GameState; summary?: GameReviewSummary; summaryFailed: boolean; onRetrySummary: () => void; ply?: number; practiceCount: number; onPractice: () => void; onSelectPly: (ply: number) => void; onReview: (fen: string, line?: CandidateLine) => void }) {
  return <section className="postgame"><div className="section-heading"><h2>Game review</h2><a href={`/api/games/${game.id}/pgn`} download>Export PGN</a></div><GameReview game={game} summary={summary} ply={ply} onSelect={onSelectPly} />{!summary ? summaryFailed ? <p className="recap-error">The recap could not be loaded. <button onClick={onRetrySummary}>Try again</button></p> : <p>Building recap…</p> : <><h3>Key moments</h3><ul>{summary.keyMoments.map((item) => <li key={item}>{item}</li>)}</ul><h3>Practical lessons</h3><ul>{summary.lessons.map((item) => <li key={item}>{item}</li>)}</ul>{summary.missing > 0 && <small>{summary.missing} move(s) did not receive full engine analysis.</small>}</>}<div className="postgame-actions">{practiceCount > 0 && <button className="practice-start" onClick={onPractice}>Practice your mistakes ({practiceCount})</button>}<button onClick={() => onReview(game.moves[0]?.beforeFen ?? new Chess().fen())}>Open a separate review board</button></div></section>;
}
