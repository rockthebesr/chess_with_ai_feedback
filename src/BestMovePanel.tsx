import type { BestMoveAdvice } from "../shared/types";

export function BestMovePanel({ advice, onClose }: { advice: BestMoveAdvice; onClose: () => void }) {
  return (
    <section className="best-move-card">
      <header>
        <span>
          Best move: <strong>{advice.san}</strong>
        </span>
        <button onClick={onClose}>Hide</button>
      </header>
      <ul>
        {advice.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p>{advice.evaluation}</p>
      {advice.comparison && <p>{advice.comparison}</p>}
      {advice.line.length > 1 && <p>Likely continuation: {advice.line.join(" ")}</p>}
    </section>
  );
}
