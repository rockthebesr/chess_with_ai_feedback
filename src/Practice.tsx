import type { PracticePosition, PracticeResult } from "../shared/types";

export interface PracticeState {
  positions: PracticePosition[];
  index: number;
  fen: string;
  checking: boolean;
  result?: PracticeResult;
  revealed: boolean;
  solvedIds: string[];
}

export function PracticePanel({
  state,
  onRetry,
  onReveal,
  onNext,
  onExit,
}: {
  state: PracticeState;
  onRetry: () => void;
  onReveal: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const position = state.positions[state.index];
  const finished = state.index === state.positions.length - 1;
  const solved = Boolean(state.result?.solved);
  return (
    <section className="practice-card">
      <div className="section-heading">
        <h2>Practice your mistakes</h2>
        <span>
          {state.index + 1} of {state.positions.length} · {state.solvedIds.length} solved
        </span>
      </div>
      <p>
        {position.mover === "white" ? "White" : "Black"} to move. In the game you played <b>{position.playedSan}</b>{" "}
        here ({position.verdict.toLowerCase()}). Find something better.
      </p>
      {state.checking && (
        <p className="pending-line">
          <i /> Checking your move…
        </p>
      )}
      {state.result && (
        <p className={solved ? "practice-result solved" : "practice-result"}>{state.result.explanation}</p>
      )}
      {state.revealed && position.bestSan && (
        <p className="practice-result">
          The engine's choice was <b>{position.bestSan}</b>.
        </p>
      )}
      <div className="practice-actions">
        {state.result && !solved && <button onClick={onRetry}>Try again</button>}
        {!solved && !state.revealed && position.bestSan && (
          <button onClick={onReveal} disabled={state.checking}>
            Show answer
          </button>
        )}
        {!finished && (
          <button className={solved ? "primary" : ""} onClick={onNext} disabled={state.checking}>
            Next position
          </button>
        )}
        <button onClick={onExit} disabled={state.checking}>
          {finished && solved ? "Finish" : "Stop practicing"}
        </button>
      </div>
    </section>
  );
}
