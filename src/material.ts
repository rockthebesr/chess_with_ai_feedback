const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const STARTING: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const ORDER = ["q", "r", "b", "n", "p"];

export interface Material {
  /** White's material minus Black's, in pawn points. */
  whiteLead: number;
  /** Letters of the pieces each side has taken, most valuable first. */
  capturedBy: { white: string[]; black: string[] };
}

export function materialFromFen(fen: string): Material {
  const counts: Record<string, number> = {};
  for (const char of fen.split(" ")[0]) if (/[a-z]/i.test(char)) counts[char] = (counts[char] ?? 0) + 1;
  const missing = (letter: string) => {
    const owned = counts[letter] ?? 0;
    return Math.max(0, STARTING[letter.toLowerCase()] - owned);
  };
  const taken = (victim: (piece: string) => string) =>
    ORDER.flatMap((piece) => Array<string>(missing(victim(piece))).fill(piece));
  const whiteLead = ORDER.reduce(
    (total, piece) => total + ((counts[piece.toUpperCase()] ?? 0) - (counts[piece] ?? 0)) * VALUES[piece],
    0,
  );
  return { whiteLead, capturedBy: { white: taken((piece) => piece), black: taken((piece) => piece.toUpperCase()) } };
}

const pointsText = (points: number) => `${points} ${points === 1 ? "point" : "points"}`;

/** With a human color, phrases it as "You"; otherwise names whichever player leads. */
export function materialSummary(
  whiteLead: number,
  names: { white: string; black: string },
  humanColor?: "white" | "black",
): string {
  if (whiteLead === 0) return "Material is even";
  if (humanColor) {
    const lead = humanColor === "white" ? whiteLead : -whiteLead;
    return `You're ${lead > 0 ? "up" : "down"} ${pointsText(Math.abs(lead))} of material`;
  }
  return `${whiteLead > 0 ? names.white : names.black} is up ${pointsText(Math.abs(whiteLead))} of material`;
}
