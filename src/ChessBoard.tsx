import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "react";
import type { BoardTheme, PieceStyle } from "../shared/types";

const pieces: Record<string, string> = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};
const solidPieces: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const letterPieces: Record<string, string> = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" };

interface Props {
  fen: string;
  orientation: "white" | "black";
  legalMoves: Array<{ from: string; to: string; promotion?: string }>;
  lastMove?: { from: string; to: string };
  disabled?: boolean;
  theme?: BoardTheme;
  pieceStyle?: PieceStyle;
  onMove: (from: string, to: string, promotion?: string) => void;
}

export function ChessBoard({ fen, orientation, legalMoves, lastMove, disabled, theme = "forest", pieceStyle = "classic", onMove }: Props) {
  const [selected, setSelected] = useState<string>();
  const [promotion, setPromotion] = useState<{ from: string; to: string }>();
  const [displayOrientation, setDisplayOrientation] = useState(orientation);
  const [flipStage, setFlipStage] = useState<"idle" | "settling" | "rotating">("idle");
  useEffect(() => {
    if (orientation === displayOrientation) { setFlipStage("idle"); return; }
    setSelected(undefined); setPromotion(undefined); setFlipStage("settling");
    let rotationTimer: number | undefined;
    const settleTimer = window.setTimeout(() => {
      setFlipStage("rotating");
      rotationTimer = window.setTimeout(() => { setDisplayOrientation(orientation); setFlipStage("idle"); }, 720);
    }, 240);
    return () => { window.clearTimeout(settleTimer); if (rotationTimer) window.clearTimeout(rotationTimer); };
  }, [orientation, displayOrientation]);
  const isTransitioning = flipStage !== "idle";
  const chess = useMemo(() => new Chess(fen), [fen]);
  const bySquare = new Map<string, { color: string; type: string }>();
  chess.board().forEach((row, rankIndex) => {
    row.forEach((piece, fileIndex) => {
      if (piece) bySquare.set(`${"abcdefgh"[fileIndex]}${8 - rankIndex}`, piece);
    });
  });
  const ranks = displayOrientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = displayOrientation === "white" ? [..."abcdefgh"] : [..."hgfedcba"];
  const destinations = selected ? new Set(legalMoves.filter((move) => move.from === selected).map((move) => move.to)) : new Set<string>();
  const checkedKing = chess.isCheck() ? [...bySquare].find(([, piece]) => piece.type === "k" && piece.color === chess.turn())?.[0] : undefined;

  const attempt = (from: string, to: string) => {
    const candidates = legalMoves.filter((move) => move.from === from && move.to === to);
    if (!candidates.length) return false;
    if (candidates.some((move) => move.promotion)) setPromotion({ from, to });
    else onMove(from, to);
    setSelected(undefined);
    return true;
  };

  const click = (square: string) => {
    if (disabled || isTransitioning) return;
    if (selected && attempt(selected, square)) return;
    const piece = bySquare.get(square);
    if (piece && legalMoves.some((move) => move.from === square)) setSelected(square);
    else setSelected(undefined);
  };

  const pieceGlyph = (color: string, type: string) => pieceStyle === "classic" ? pieces[`${color}${type}`] : pieceStyle === "solid" ? solidPieces[type] : letterPieces[type];

  return <section className={`board-wrap theme-${theme} pieces-${pieceStyle}${flipStage === "rotating" ? " is-flipping" : ""}${flipStage === "settling" ? " is-settling" : ""}`} aria-label={`Chess board, ${displayOrientation} side facing you`} aria-busy={isTransitioning}>
    <div className="board">
      {ranks.flatMap((rank) => files.map((file) => {
        const square = `${file}${rank}`;
        const piece = bySquare.get(square);
        const dark = ((file.charCodeAt(0) - 97) + rank) % 2 === 1;
        const classes = ["square", dark ? "dark" : "light", selected === square ? "selected" : "",
          destinations.has(square) ? "destination" : "", lastMove && (lastMove.from === square || lastMove.to === square) ? "last" : "",
          checkedKing === square ? "check" : ""].filter(Boolean).join(" ");
        return <button key={square} className={classes} data-square={square} onClick={() => click(square)}
          draggable={Boolean(piece) && !disabled && !isTransitioning}
          onDragStart={(event) => { event.dataTransfer.setData("text/plain", square); setSelected(square); }}
          onDragOver={(event) => { if (!disabled && !isTransitioning) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); if (!disabled && !isTransitioning) attempt(event.dataTransfer.getData("text/plain"), square); }}
          aria-label={`${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : " empty"}`}>
          {piece && <span className={`piece ${piece.color} ${pieceStyle}`}>{pieceGlyph(piece.color, piece.type)}</span>}
          {file === files[0] && <span className="rank-label">{rank}</span>}
          {rank === ranks[ranks.length - 1] && <span className="file-label">{file}</span>}
        </button>;
      }))}
    </div>
    {promotion && <div className="promotion" role="dialog" aria-label="Choose promotion piece">
      <div><p>Promote pawn to</p>{["q", "r", "b", "n"].map((type) =>
        <button key={type} onClick={() => { onMove(promotion.from, promotion.to, type); setPromotion(undefined); }}>
          <span className={`piece ${chess.turn()} ${pieceStyle}`}>{pieceGlyph(chess.turn(), type)}</span>
        </button>)}<button className="cancel" onClick={() => setPromotion(undefined)}>Cancel</button></div>
    </div>}
  </section>;
}
