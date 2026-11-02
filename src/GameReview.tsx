import type { GameReviewSummary, GameState } from "../shared/types";

const GRAPH_WIDTH = 100;
const GRAPH_HEIGHT = 36;

export function moveLabel(move: GameState["moves"][number]): string {
  return `${Math.ceil(move.ply / 2)}${move.mover === "black" ? "…" : "."} ${move.san}`;
}

function verdictClass(verdict?: string): string {
  return verdict ? verdict.toLowerCase().replaceAll(" ", "-") : "";
}

function EvaluationGraph({
  game,
  summary,
  ply,
  onSelect,
}: {
  game: GameState;
  summary: GameReviewSummary;
  ply?: number;
  onSelect: (ply: number) => void;
}) {
  const count = game.moves.length;
  if (!count || !summary.evaluation.length) return null;
  const x = (at: number) => (at / count) * GRAPH_WIDTH;
  const y = (chance: number) => GRAPH_HEIGHT - (chance / 100) * GRAPH_HEIGHT;
  const points = [{ ply: 0, whiteWinChance: 50 }, ...summary.evaluation];
  const line = points.map((point) => `${x(point.ply)},${y(point.whiteWinChance)}`).join(" ");
  const area = `0,${GRAPH_HEIGHT} ${line} ${x(points.at(-1)!.ply)},${GRAPH_HEIGHT}`;
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="White's estimated chance of winning after each move"
    >
      <polygon className="eval-area" points={area} />
      <line className="eval-mid" x1="0" x2={GRAPH_WIDTH} y1={GRAPH_HEIGHT / 2} y2={GRAPH_HEIGHT / 2} />
      <polyline className="eval-line" points={line} vectorEffect="non-scaling-stroke" />
      {ply !== undefined && (
        <line
          className="eval-marker"
          x1={x(ply)}
          x2={x(ply)}
          y1="0"
          y2={GRAPH_HEIGHT}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {game.moves.map((move) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the move list beside the graph is the keyboard path.
        <rect
          key={move.id}
          className="eval-hit"
          x={x(move.ply - 0.5)}
          y="0"
          width={GRAPH_WIDTH / count}
          height={GRAPH_HEIGHT}
          onClick={() => onSelect(move.ply)}
        >
          <title>{moveLabel(move)}</title>
        </rect>
      ))}
    </svg>
  );
}

export function GameReview({
  game,
  summary,
  ply,
  onSelect,
}: {
  game: GameState;
  summary?: GameReviewSummary;
  ply?: number;
  onSelect: (ply: number) => void;
}) {
  if (!game.moves.length) return null;
  const { white, black } = summary?.accuracy ?? {};
  return (
    <div className="game-review">
      {(white !== undefined || black !== undefined) && (
        <p className="accuracy">
          <span>
            <b>
              {white ?? "–"}
              {white !== undefined && "%"}
            </b>{" "}
            {game.settings.whiteName}
          </span>
          <span>
            <b>
              {black ?? "–"}
              {black !== undefined && "%"}
            </b>{" "}
            {game.settings.blackName}
          </span>
          <small>Accuracy</small>
        </p>
      )}
      {summary && <EvaluationGraph game={game} summary={summary} ply={ply} onSelect={onSelect} />}
      <div className="review-moves">
        {game.moves.map((move) => (
          <button
            key={move.id}
            className={`review-move ${verdictClass(game.analysis[move.id]?.verdict)}${ply === move.ply ? " current" : ""}`}
            onClick={() => onSelect(move.ply)}
          >
            {moveLabel(move)}
          </button>
        ))}
      </div>
      <small className="review-hint">Use ← and → to step through the game.</small>
    </div>
  );
}
