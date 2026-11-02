import { Chess } from "chess.js";
import openingBook from "./data/eco.json" with { type: "json" };
import type { OpeningMatch } from "../shared/types.js";

type EcoOpening = { eco?: string; name?: string; moves?: string };

// Offline copy of the MIT-licensed eco.json book: over 15,000 named ECO positions,
// including equivalent positions reached through different move orders.
const positions = new Map<string, EcoOpening[]>();
for (const [fen, opening] of Object.entries(openingBook as Record<string, EcoOpening>)) {
  const key = positionKey(fen);
  const bucket = positions.get(key) ?? [];
  bucket.push(opening);
  positions.set(key, bucket);
}

function positionKey(fen: string): string { return fen.split(" ").slice(0, 4).join(" "); }

function pickBest(matches: EcoOpening[]): EcoOpening | undefined {
  return matches
    .filter((item) => item.name && item.eco)
    .sort((a, b) => (b.moves?.length ?? 0) - (a.moves?.length ?? 0) || (a.name?.length ?? 0) - (b.name?.length ?? 0))[0];
}

function guidance(name: string, color: "white" | "black"): string | undefined {
  if (/london/i.test(name)) return color === "white"
    ? "Keep the light bishop outside the pawn chain, castle, then prepare a supported central break."
    : "Challenge d4 and develop actively before White completes the solid setup.";
  if (/sicilian/i.test(name)) return color === "white"
    ? "Finish development and decide when to challenge Black's c-pawn pressure in the center."
    : "Use the c-pawn pressure on d4 and create queenside counterplay after developing.";
  if (/king.s indian|gr.nfeld|nimzo|queen.s indian/i.test(name)) return color === "white"
    ? "Use your central space, finish development, and watch for pressure on the d4 pawn."
    : "Develop safely, pressure the center, and look for timely counterplay rather than grabbing pawns.";
  if (/queen.s gambit/i.test(name)) return color === "white"
    ? "Develop behind the central pawns and use piece pressure to support a central break."
    : "Complete development and challenge the center without trapping the light bishop.";
  return undefined;
}

export function recognizeOpening(sans: string[]): OpeningMatch | undefined {
  const chess = new Chess();
  for (const san of sans) { try { chess.move(san); } catch { break; } }
  const current = chess;
  let movesBack = 0;
  let match = pickBest(positions.get(positionKey(current.fen())) ?? []);
  // If play leaves theory, preserve the deepest known opening rather than falling back
  // to a vague parent label.
  while (!match && current.history().length && movesBack < 50) {
    current.undo();
    movesBack += 1;
    match = pickBest(positions.get(positionKey(current.fen())) ?? []);
  }
  if (!match?.name || !match.eco) return undefined;
  const variation = match.name.includes(":") ? match.name.split(":").slice(1).join(":").trim() || undefined : undefined;
  const whiteGuidance = guidance(match.name, "white");
  const blackGuidance = guidance(match.name, "black");
  const guidanceAvailable = Boolean(whiteGuidance && blackGuidance);
  return {
    eco: match.eco, name: match.name, variation,
    matchedPly: Math.max(0, sans.length - movesBack), matchMethod: "position", current: movesBack === 0,
    plansWhite: whiteGuidance ?? "No verified opening-specific plan is stored for this position.",
    plansBlack: blackGuidance ?? "No verified opening-specific plan is stored for this position.",
    strengths: guidanceAvailable ? `${match.name} gives the position its characteristic pawn structure and piece setup.` : "The name is verified from the position book; strategic guidance must come from the board itself.",
    tradeoffs: guidanceAvailable ? "The opening label describes the position, but plans should still adapt to the opponent's moves." : "Opening recognition does not by itself verify a strategic plan.",
    mistakes: ["Following a setup without checking the opponent's threats", "Delaying king safety while chasing an opening idea"],
    guidanceAvailable,
  };
}

export function describeOpening(match: OpeningMatch): string {
  return match.current
    ? `${match.name} (${match.eco})`
    : `Last recognized opening: ${match.name} (${match.eco}); now outside the named book line.`;
}
