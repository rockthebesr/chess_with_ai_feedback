import { Chess } from "chess.js";
import { useEffect, useState } from "react";
import type {
  BestMoveAdvice,
  CandidateLine,
  GameReviewSummary,
  GameSettings,
  GameState,
  ProviderStatus,
} from "../shared/types";
import { api } from "./api";
import { BestMovePanel } from "./BestMovePanel";
import { ChessBoard } from "./ChessBoard";
import { moveLabel } from "./GameReview";
import { MoveCard } from "./MoveCard";
import { Postgame } from "./Postgame";
import { PracticePanel, type PracticeState } from "./Practice";

function appearanceFor(game: GameState): Pick<GameSettings, "boardTheme" | "pieceStyle"> {
  try {
    const saved = JSON.parse(localStorage.getItem("chess-coach-appearance") ?? "{}") as Partial<GameSettings>;
    return {
      boardTheme: saved.boardTheme ?? game.settings.boardTheme ?? "forest",
      pieceStyle: saved.pieceStyle ?? game.settings.pieceStyle ?? "classic",
    };
  } catch {
    return { boardTheme: game.settings.boardTheme ?? "forest", pieceStyle: game.settings.pieceStyle ?? "classic" };
  }
}

function rememberAppearance(boardTheme: GameSettings["boardTheme"], pieceStyle: GameSettings["pieceStyle"]): void {
  localStorage.setItem("chess-coach-appearance", JSON.stringify({ boardTheme, pieceStyle }));
}

export function GameRoom({
  game,
  provider,
  stockfish,
  error,
  setError,
  onGame,
  onHome,
}: {
  game: GameState;
  provider: ProviderStatus;
  stockfish: boolean;
  error?: string;
  setError: (value?: string) => void;
  onGame: (game: GameState) => void;
  onHome: () => void;
}) {
  const initialOrientation = game.settings.mode === "bot" ? game.settings.humanColor : "white";
  const [manualOrientation, setManualOrientation] = useState<"white" | "black">(initialOrientation);
  const [review, setReview] = useState<{
    fen: string;
    legalMoves: GameState["legalMoves"];
    label: string;
    ply?: number;
    lastMove?: { from: string; to: string };
  }>();
  const [summary, setSummary] = useState<GameReviewSummary>();
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [practice, setPractice] = useState<PracticeState>();
  const [advice, setAdvice] = useState<BestMoveAdvice>();
  const [askingBestMove, setAskingBestMove] = useState(false);
  const [boardTheme, setBoardTheme] = useState(() => appearanceFor(game).boardTheme);
  const [pieceStyle, setPieceStyle] = useState(() => appearanceFor(game).pieceStyle);
  const orientation = practice ? practice.positions[practice.index].mover : manualOrientation;
  const last = game.moves.at(-1);
  const coachedMoves =
    game.settings.mode === "bot" ? game.moves.filter((move) => move.mover === game.settings.humanColor) : game.moves;
  const moveAllowed =
    game.status === "active" &&
    !game.paused &&
    !(game.settings.mode === "bot" && game.turn !== game.settings.humanColor);

  const update = async (work: Promise<GameState>) => {
    setError(undefined);
    try {
      onGame(await work);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    }
  };
  const makeMove = (from: string, to: string, promotion?: string) =>
    void update(api.move(game.id, { from, to, promotion, expectedRevision: game.revision }));
  const reviewMove = (from: string, to: string, promotion?: string) => {
    if (!review) return;
    const chess = new Chess(review.fen);
    try {
      const moved = chess.move({ from, to, promotion });
      setReview({
        fen: chess.fen(),
        legalMoves: legalFor(chess),
        label: `${review.label} · ${moved.san}`,
        ply: review.ply,
        lastMove: { from: moved.from, to: moved.to },
      });
    } catch {
      /* board already limits moves */
    }
  };
  // The answer only applies to the position it was asked about, so it disappears as soon as the board changes.
  const shownFen = review?.fen ?? game.fen;
  const shownAdvice = advice?.fen === shownFen ? advice : undefined;
  const bestMoveAvailable =
    stockfish &&
    !practice &&
    (review
      ? legalFor(new Chess(review.fen)).length > 0
      : game.status === "active" && !(game.settings.mode === "bot" && game.turn !== game.settings.humanColor));
  const askBestMove = async () => {
    setError(undefined);
    setAskingBestMove(true);
    try {
      setAdvice(await api.bestMove(game.id, review?.fen));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The best move could not be found.");
    } finally {
      setAskingBestMove(false);
    }
  };
  const startPractice = async () => {
    setError(undefined);
    try {
      const positions = await api.practice(game.id);
      if (!positions.length) return;
      setReview(undefined);
      setPractice({ positions, index: 0, fen: positions[0].fen, checking: false, revealed: false, solvedIds: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Practice could not start.");
    }
  };
  const showPractice = (index: number) =>
    setPractice(
      (current) =>
        current && {
          ...current,
          index,
          fen: current.positions[index].fen,
          checking: false,
          result: undefined,
          revealed: false,
        },
    );
  const practiceMove = async (from: string, to: string, promotion?: string) => {
    if (!practice) return;
    const position = practice.positions[practice.index];
    const board = new Chess(position.fen);
    try {
      board.move({ from, to, promotion });
    } catch {
      return;
    }
    setError(undefined);
    setPractice({ ...practice, fen: board.fen(), checking: true, result: undefined });
    try {
      const result = await api.practiceAttempt(game.id, position.moveId, { from, to, promotion });
      setPractice(
        (current) =>
          current && {
            ...current,
            checking: false,
            result,
            solvedIds:
              result.solved && !current.solvedIds.includes(position.moveId)
                ? [...current.solvedIds, position.moveId]
                : current.solvedIds,
          },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That move could not be checked.");
      setPractice((current) => current && { ...current, fen: position.fen, checking: false });
    }
  };
  useEffect(() => {
    setPractice(undefined);
  }, [game.id, game.branchId]);
  const showPly = (ply: number) => {
    const target = Math.max(0, Math.min(game.moves.length, ply));
    const move = game.moves[target - 1];
    const fen = move?.afterFen ?? game.moves[0]?.beforeFen ?? new Chess().fen();
    setReview({
      fen,
      legalMoves: legalFor(new Chess(fen)),
      label: move ? stepLabel(game, move) : "Starting position",
      ply: target,
      lastMove: move && { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) },
    });
  };
  // Runs after every render so the handler always sees the latest game and analysis.
  useEffect(() => {
    if (game.status !== "complete" || practice) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, select, textarea")) return;
      const current = review?.ply ?? game.moves.length;
      const next =
        event.key === "ArrowLeft"
          ? current - 1
          : event.key === "ArrowRight"
            ? current + 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? game.moves.length
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      showPly(next);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  // Refetch as verdicts land: the last live analysis and the post-game recheck both arrive after the game ends.
  const verdicts = game.moves.map((move) => game.analysis[move.id]?.verdict).join();
  useEffect(() => {
    if (game.status !== "complete") return;
    let current = true;
    setSummaryFailed(false);
    api
      .summary(game.id)
      .then((loaded) => {
        if (current) setSummary(loaded);
      })
      .catch(() => {
        if (current) setSummaryFailed(true);
      });
    return () => {
      current = false;
    };
  }, [game.status, game.id, verdicts, summaryAttempt]);
  useEffect(() => {
    if (game.settings.mode === "local" && game.settings.autoFlip) setManualOrientation(game.turn);
  }, [game.turn, game.settings.mode, game.settings.autoFlip]);
  useEffect(() => {
    const appearance = appearanceFor(game);
    setBoardTheme(appearance.boardTheme);
    setPieceStyle(appearance.pieceStyle);
  }, [game.id]);

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand" onClick={onHome}>
          ♞ <span>Local Chess Coach</span>
        </button>
        <div className="game-meta">
          <span>{game.settings.whiteName}</span>
          <b>{game.result === "*" ? "vs" : game.result}</b>
          <span>{game.settings.blackName}</span>
        </div>
        <button className="quiet" onClick={onHome}>
          All games
        </button>
      </header>
      {error && (
        <div className="alert floating">
          {error}
          <button onClick={() => setError(undefined)}>×</button>
        </div>
      )}
      <div className="play-layout">
        <section className="board-column">
          <Player
            name={orientation === "white" ? game.settings.blackName : game.settings.whiteName}
            color={orientation === "white" ? "black" : "white"}
            active={game.turn === (orientation === "white" ? "black" : "white") && game.status === "active"}
          />
          {practice ? (
            <ChessBoard
              fen={practice.fen}
              orientation={orientation}
              legalMoves={legalFor(new Chess(practice.fen))}
              disabled={practice.checking || Boolean(practice.result)}
              theme={boardTheme}
              pieceStyle={pieceStyle}
              onMove={(from, to, promotion) => void practiceMove(from, to, promotion)}
            />
          ) : (
            <ChessBoard
              fen={review?.fen ?? game.fen}
              orientation={orientation}
              legalMoves={review?.legalMoves ?? game.legalMoves}
              hint={shownAdvice}
              lastMove={
                review ? review.lastMove : last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : undefined
              }
              disabled={review ? false : !moveAllowed}
              theme={boardTheme}
              pieceStyle={pieceStyle}
              onMove={review ? reviewMove : makeMove}
            />
          )}
          <Player
            name={orientation === "white" ? game.settings.whiteName : game.settings.blackName}
            color={orientation}
            active={game.turn === orientation && game.status === "active"}
          />
          {review && (
            <div className="review-banner">
              <span>
                <strong>Review board</strong> — {review.label}
              </span>
              <button onClick={() => setReview(undefined)}>Return to game</button>
            </div>
          )}
          <div className="controls">
            <button
              className="best-move-button"
              onClick={() => void askBestMove()}
              disabled={!bestMoveAvailable || askingBestMove}
              title={stockfish ? undefined : "Install Stockfish to see the best move."}
            >
              {askingBestMove ? "Thinking…" : "★ Best move & why"}
            </button>
            <button onClick={() => setManualOrientation((value) => (value === "white" ? "black" : "white"))}>
              ↻ Flip
            </button>
            <button onClick={() => void update(api.action(game.id, "undo"))} disabled={!game.moves.length}>
              ↶ Take back
            </button>
            <button
              onClick={() => {
                if (confirm("Restart this game from the beginning?")) void update(api.action(game.id, "restart"));
              }}
            >
              Restart
            </button>
            {game.settings.mode === "local" && (
              <button onClick={() => void update(api.action(game.id, "draw"))} disabled={game.status !== "active"}>
                Agree draw
              </button>
            )}
            <details className="appearance-menu">
              <summary>Appearance</summary>
              <div>
                <label>
                  Board
                  <select
                    aria-label="Board colors"
                    value={boardTheme}
                    onChange={(e) => {
                      const value = e.target.value as GameSettings["boardTheme"];
                      setBoardTheme(value);
                      rememberAppearance(value, pieceStyle);
                    }}
                  >
                    <option value="forest">Forest</option>
                    <option value="walnut">Walnut</option>
                    <option value="slate">Slate</option>
                    <option value="contrast">High contrast</option>
                  </select>
                </label>
                <label>
                  Pieces
                  <select
                    aria-label="Piece style"
                    value={pieceStyle}
                    onChange={(e) => {
                      const value = e.target.value as GameSettings["pieceStyle"];
                      setPieceStyle(value);
                      rememberAppearance(boardTheme, value);
                    }}
                  >
                    <option value="classic">Classic</option>
                    <option value="solid">Solid</option>
                    <option value="letters">Letters</option>
                  </select>
                </label>
              </div>
            </details>
            <button
              className="danger"
              onClick={() => {
                if (confirm("Resign this game?")) void update(api.resign(game.id, game.turn));
              }}
              disabled={game.status !== "active"}
            >
              Resign
            </button>
          </div>
        </section>
        <aside className="coach-column">
          {shownAdvice && !practice && <BestMovePanel advice={shownAdvice} onClose={() => setAdvice(undefined)} />}
          <section className="turn-card">
            <div>
              <span className="eyebrow">{game.status === "active" ? "Current turn" : "Game over"}</span>
              <h2>
                {game.status === "active"
                  ? `${game.turn === "white" ? game.settings.whiteName : game.settings.blackName} to move`
                  : `${game.result} · ${game.resultReason ?? "finished"}`}
              </h2>
            </div>
            <div className={`mode-pill ${game.settings.practice}`}>
              {game.settings.practice === "guided" ? "Guided practice" : "Normal play"}
            </div>
          </section>
          {game.paused && (
            <section className="pause-card">
              <span>Lesson pause</span>
              <p>You can read the latest feedback now, or continue even if coaching is still arriving.</p>
              <button className="primary" onClick={() => void update(api.continue(game.id, game.revision))}>
                Continue game →
              </button>
            </section>
          )}
          {game.opening ? (
            <OpeningCard game={game} />
          ) : (
            game.moves.length > 1 && (
              <section className="unknown-opening">
                <small>OPENING</small>
                <strong>Outside the starter catalog</strong>
                <p>The moves are legal, but this position has no supported name in the local opening set.</p>
              </section>
            )
          )}
          {practice && (
            <PracticePanel
              state={practice}
              onRetry={() => showPractice(practice.index)}
              onReveal={() => setPractice({ ...practice, revealed: true })}
              onNext={() => showPractice(practice.index + 1)}
              onExit={() => setPractice(undefined)}
            />
          )}
          {game.status === "complete" && !practice && (
            <Postgame
              game={game}
              summary={summary}
              summaryFailed={summaryFailed}
              onRetrySummary={() => setSummaryAttempt((value) => value + 1)}
              ply={review?.ply}
              practiceCount={
                coachedMoves.filter((move) => {
                  const analysis = game.analysis[move.id];
                  return (
                    analysis?.status === "complete" &&
                    (analysis.verdict === "Mistake" || analysis.verdict === "Blunder")
                  );
                }).length
              }
              onPractice={() => void startPractice()}
              onSelectPly={showPly}
              onReview={(fen, line) => setReview(reviewFromLine(fen, line))}
            />
          )}
          <section className="moves-section">
            <div className="section-heading">
              <h2>{game.settings.mode === "bot" ? "Your coaching" : "Move-by-move coaching"}</h2>
              <span>
                {coachedMoves.length} {coachedMoves.length === 1 ? "move" : "moves"}
              </span>
            </div>
            {!coachedMoves.length && (
              <div className="empty">
                <span>♙</span>
                <h3>Your first lesson starts with your first move.</h3>
                <p>Click or drag a piece. Legal destinations will light up.</p>
              </div>
            )}
            <div className="move-feed">
              {[...coachedMoves].reverse().map((move) => (
                <MoveCard
                  key={move.id}
                  game={game}
                  moveId={move.id}
                  provider={provider}
                  stockfish={stockfish}
                  onReview={(line) => setReview(reviewFromLine(move.beforeFen, line))}
                />
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function stepLabel(game: GameState, move: GameState["moves"][number]): string {
  const analysis = game.analysis[move.id];
  const preferred = analysis?.alternatives[0]?.san[0];
  const marked =
    analysis?.verdict === "Inaccuracy" || analysis?.verdict === "Mistake" || analysis?.verdict === "Blunder";
  return `${moveLabel(move)}${marked ? ` · ${analysis.verdict}` : ""}${marked && preferred && preferred !== move.san ? ` · engine preferred ${preferred}` : ""}`;
}

function legalFor(chess: Chess): GameState["legalMoves"] {
  return chess.moves({ verbose: true }).map((move) => ({ from: move.from, to: move.to, promotion: move.promotion }));
}
function reviewFromLine(fen: string, line?: CandidateLine) {
  const chess = new Chess(fen);
  const shown: string[] = [];
  if (line)
    for (const uci of line.uci) {
      try {
        shown.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
      } catch {
        break;
      }
    }
  return {
    fen: chess.fen(),
    legalMoves: legalFor(chess),
    label: shown.length ? shown.join(" ") : "Explore your own alternatives",
  };
}

function Player({ name, color, active }: { name: string; color: "white" | "black"; active: boolean }) {
  return (
    <div className={`player ${active ? "active" : ""}`}>
      <span className={`avatar ${color}`}>{name[0]?.toUpperCase() || "?"}</span>
      <strong>{name}</strong>
      {active && <small>thinking</small>}
    </div>
  );
}

function OpeningCard({ game }: { game: GameState }) {
  const opening = game.opening!;
  return (
    <details className="opening-card" open>
      <summary>
        <span>
          <small>OPENING · {opening.eco}</small>
          <strong>{opening.current ? opening.name : `Last recognized: ${opening.name}`}</strong>
        </span>
        <span>⌄</span>
      </summary>
      <div className="opening-body">
        {!opening.current && <p className="outside">Now outside the stored line.</p>}
        {opening.guidanceAvailable ? (
          <>
            <div>
              <b>White's plan</b>
              <p>{opening.plansWhite}</p>
            </div>
            <div>
              <b>Black's plan</b>
              <p>{opening.plansBlack}</p>
            </div>
            <p className="tradeoff">
              <b>Tradeoff:</b> {opening.tradeoffs}
            </p>
          </>
        ) : (
          <p className="outside">
            The opening name is verified from the position book. Coaching will use the current board because no
            opening-specific plan is stored for this line.
          </p>
        )}
      </div>
    </details>
  );
}
