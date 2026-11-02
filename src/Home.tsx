import { useEffect, useState } from "react";
import type { GameSettings, GameSummary, PlayerPatterns, ProviderStatus } from "../shared/types";
import { api } from "./api";

const initialSettings: GameSettings = {
  mode: "bot",
  whiteName: "Rock",
  blackName: "Christine",
  humanColor: "white",
  difficulty: "easy",
  practice: "normal",
  autoFlip: false,
  hintsVisible: false,
  boardTheme: "forest",
  pieceStyle: "classic",
};

export function Home({
  games,
  provider,
  stockfish,
  error,
  onCreate,
  onResume,
  onDelete,
  onDeleteAll,
}: {
  games: GameSummary[];
  provider: ProviderStatus;
  stockfish: boolean;
  error?: string;
  onCreate: (settings: GameSettings) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  const saved = localStorage.getItem("chess-coach-settings");
  const [settings, setSettings] = useState<GameSettings>(
    saved ? { ...initialSettings, ...JSON.parse(saved) } : initialSettings,
  );
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    setSettings((old) => ({ ...old, [key]: value }));
  const start = () => {
    localStorage.setItem("chess-coach-settings", JSON.stringify(settings));
    onCreate(settings);
  };
  const [patterns, setPatterns] = useState<PlayerPatterns[]>([]);
  useEffect(() => {
    void api
      .patterns()
      .then(setPatterns)
      .catch(() => setPatterns([]));
  }, [games.length]);
  return (
    <main className="home-shell">
      <header className="hero">
        <span className="eyebrow">A quiet place to learn together</span>
        <h1>Local Chess Coach</h1>
        <p>Play a real game. Get a clear lesson after every move.</p>
      </header>
      {error && <div className="alert">{error}</div>}
      <section className="home-grid">
        <div className="card setup-card">
          <h2>Start a game</h2>
          <div className="segmented">
            <button className={settings.mode === "bot" ? "active" : ""} onClick={() => update("mode", "bot")}>
              Play the coach bot
            </button>
            <button className={settings.mode === "local" ? "active" : ""} onClick={() => update("mode", "local")}>
              Two people here
            </button>
          </div>
          <div className="form-grid">
            <label>
              White player
              <input value={settings.whiteName} onChange={(e) => update("whiteName", e.target.value)} />
            </label>
            <label>
              Black player
              <input
                value={settings.blackName}
                disabled={settings.mode === "bot"}
                onChange={(e) => update("blackName", e.target.value)}
              />
            </label>
            {settings.mode === "bot" && (
              <>
                <label>
                  Your color
                  <select
                    value={settings.humanColor}
                    onChange={(e) => update("humanColor", e.target.value as GameSettings["humanColor"])}
                  >
                    <option value="white">White</option>
                    <option value="black">Black</option>
                  </select>
                </label>
                <label>
                  Bot level
                  <select
                    value={settings.difficulty}
                    onChange={(e) => update("difficulty", e.target.value as GameSettings["difficulty"])}
                  >
                    <option value="beginner">Beginner</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="strong">Strong</option>
                  </select>
                </label>
              </>
            )}
            <label>
              Learning pace
              <select
                value={settings.practice}
                onChange={(e) => update("practice", e.target.value as GameSettings["practice"])}
              >
                <option value="normal">Normal — keep playing</option>
                <option value="guided">Guided — pause after moves</option>
              </select>
            </label>
            <label>
              Board colors
              <select
                value={settings.boardTheme}
                onChange={(e) => update("boardTheme", e.target.value as GameSettings["boardTheme"])}
              >
                <option value="forest">Forest green</option>
                <option value="walnut">Warm walnut</option>
                <option value="slate">Cool slate</option>
                <option value="contrast">High contrast</option>
              </select>
            </label>
            <label>
              Pieces
              <select
                value={settings.pieceStyle}
                onChange={(e) => update("pieceStyle", e.target.value as GameSettings["pieceStyle"])}
              >
                <option value="classic">Classic outline</option>
                <option value="solid">Solid silhouettes</option>
                <option value="letters">Letter tokens</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={settings.autoFlip} onChange={(e) => update("autoFlip", e.target.checked)} />
            Flip the board after each turn
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.hintsVisible}
              onChange={(e) => update("hintsVisible", e.target.checked)}
            />
            <span>
              Show engine suggestion lines during the game{" "}
              <small>Both players can open suggested continuations before the game ends.</small>
            </span>
          </label>
          <button className="primary big" onClick={start}>
            Set up the board <span>→</span>
          </button>
        </div>
        <aside className="side-stack">
          <div className="card status-card">
            <h3>Ready check</h3>
            <StatusDot
              ok={provider.available}
              label={
                provider.available
                  ? `${provider.authMode === "local" ? "Local coaching" : "ChatGPT coaching"} · ${provider.planType ?? "ready"}`
                  : "Coaching fallback"
              }
              detail={provider.available ? provider.model : provider.error}
            />
            <StatusDot
              ok={stockfish}
              label={stockfish ? "Stockfish analysis" : "Rules-based analysis"}
              detail={stockfish ? "Local engine ready" : "Install Stockfish for deeper feedback"}
            />
          </div>
          <div className="card saved">
            <div className="saved-heading">
              <h3>Saved games</h3>
              {games.length > 0 && (
                <button className="saved-delete-all" onClick={onDeleteAll}>
                  Delete all
                </button>
              )}
            </div>
            {games.length === 0 ? (
              <p className="muted">Your games will appear here automatically.</p>
            ) : (
              games.slice(0, 8).map((item) => (
                <div className="saved-row" key={item.id}>
                  <button className="saved-open" onClick={() => onResume(item.id)}>
                    <span>
                      <strong>
                        {item.whiteName} vs {item.blackName}
                      </strong>
                      <small>
                        {item.moveCount} moves · {item.status === "active" ? "In progress" : item.result}
                      </small>
                    </span>
                    <span>›</span>
                  </button>
                  <button
                    className="saved-delete"
                    aria-label={`Delete ${item.whiteName} versus ${item.blackName}`}
                    title="Delete saved game"
                    onClick={() => onDelete(item.id)}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
          <PatternsCard players={patterns} />
        </aside>
      </section>
    </main>
  );
}

// Too few mistakes make a percentage look more meaningful than it is.
const MIN_MISTAKES_FOR_PATTERNS = 3;
function PatternsCard({ players }: { players: PlayerPatterns[] }) {
  const ready = players.filter((player) => player.mistakes >= MIN_MISTAKES_FOR_PATTERNS);
  return (
    <div className="card patterns">
      <h3>Mistake patterns</h3>
      {!ready.length && <p className="muted">Finish a few games and your most common mistakes will appear here.</p>}
      {ready.map((player) => (
        <div className="pattern-player" key={player.name}>
          <strong>{player.name}</strong>
          <small>
            {player.mistakes} mistakes across {player.games} {player.games === 1 ? "game" : "games"}
          </small>
          <ul>
            {player.patterns.slice(0, 4).map((pattern) => (
              <li key={pattern.id}>
                <span>{pattern.label}</span>
                <b>{pattern.share}%</b>
                <i style={{ width: `${pattern.share}%` }} />
              </li>
            ))}
          </ul>
          <p className="pattern-advice">{player.patterns[0].advice}</p>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="status-row">
      <i className={ok ? "ok" : "warn"} />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}
