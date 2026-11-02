import { useState } from "react";
import type { CandidateLine, GameState, ProviderStatus } from "../shared/types";
import { api } from "./api";

export function MoveCard({ game, moveId, provider, stockfish, onReview }: { game: GameState; moveId: string; provider: ProviderStatus; stockfish: boolean; onReview: (line?: CandidateLine) => void }) {
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
    {!coachingSkipped && askError && <p className="mini-error">{askError}</p>}{!coachingSkipped && coaching?.followups?.map((item) => <div className="followup" key={item.createdAt}><b>You asked:</b> {item.question}<p>{item.answer}</p></div>)}
    {(coaching?.status === "verified-fallback" || coaching?.status === "unavailable") && <small className="offline-note">Verified coaching summary · play remains available</small>}
    {!stockfish && analysis?.status === "unavailable" && <small className="offline-note">Install Stockfish for verified candidate lines</small>}
  </article>;
}

function Verdict({ verdict, pending }: { verdict?: string; pending: boolean }) {
  const friendly = verdict === "Good move" ? "Nice move" : verdict === "Inaccuracy" ? "Could be better" : verdict === "Mistake" ? "Not a good move" : verdict === "Blunder" ? "Serious mistake" : "Let's review";
  return <span className={`verdict ${pending ? "pending" : verdict?.toLowerCase().replaceAll(" ", "-")}`}>{pending ? "Thinking" : friendly}</span>;
}
