export type GameMode = "bot" | "local";
export type PracticeMode = "normal" | "guided";
export type Color = "white" | "black";
export type Difficulty = "beginner" | "easy" | "medium" | "strong";
export type BoardTheme = "forest" | "walnut" | "slate" | "contrast";
export type PieceStyle = "classic" | "solid" | "letters";
export type Verdict = "Good move" | "Inaccuracy" | "Mistake" | "Blunder" | "Analysis uncertain";

export interface GameSettings {
  mode: GameMode;
  whiteName: string;
  blackName: string;
  humanColor: Color;
  difficulty: Difficulty;
  practice: PracticeMode;
  autoFlip: boolean;
  hintsVisible: boolean;
  boardTheme: BoardTheme;
  pieceStyle: PieceStyle;
}

export interface MoveRecord {
  id: string;
  gameId: string;
  branchId: string;
  revision: number;
  ply: number;
  mover: Color;
  beforeFen: string;
  afterFen: string;
  san: string;
  uci: string;
  createdAt: string;
}

export interface CandidateLine {
  id: string;
  scoreCp?: number;
  mate?: number;
  uci: string[];
  san: string[];
}

export interface AnalysisRecord {
  moveId: string;
  status: "pending" | "complete" | "unavailable" | "cancelled";
  verdict: Verdict;
  beforeCp?: number;
  afterCp?: number;
  beforeMate?: number;
  afterMate?: number;
  lossCp?: number;
  depth?: number;
  budgetMs: number;
  engine: string;
  alternatives: CandidateLine[];
  continuation?: CandidateLine;
  note?: string;
  /** Set once the post-game pass has rechecked this verdict with a longer search. */
  rechecked?: boolean;
}

export interface CoachingRecord {
  moveId: string;
  status: "queued" | "streaming" | "complete" | "verified-fallback" | "unavailable" | "cancelled" | "skipped";
  verdict?: Verdict;
  explanation?: string;
  lesson?: string;
  streamedText?: string;
  provider?: string;
  model?: string;
  error?: string;
  followups?: Array<{ question: string; answer: string; createdAt: string }>;
}

export interface OpeningMatch {
  eco: string;
  name: string;
  variation?: string;
  matchedPly: number;
  matchMethod: "sequence" | "position";
  plansWhite: string;
  plansBlack: string;
  strengths: string;
  tradeoffs: string;
  mistakes: string[];
  current: boolean;
  guidanceAvailable: boolean;
}

export interface GameState {
  /** Stored format version; see server/game-schema.ts. */
  stateVersion?: number;
  id: string;
  branchId: string;
  revision: number;
  settings: GameSettings;
  fen: string;
  turn: Color;
  status: "active" | "complete";
  result: string;
  resultReason?: string;
  paused: boolean;
  pgn: string;
  moves: MoveRecord[];
  legalMoves: Array<{ from: string; to: string; promotion?: string }>;
  analysis: Record<string, AnalysisRecord>;
  coaching: Record<string, CoachingRecord>;
  opening?: OpeningMatch;
  createdAt: string;
  updatedAt: string;
}

export interface GameSummary {
  id: string;
  whiteName: string;
  blackName: string;
  mode: GameMode;
  status: "active" | "complete";
  result: string;
  moveCount: number;
  updatedAt: string;
}

export interface GameReviewSummary {
  keyMoments: string[];
  lessons: string[];
  missing: number;
  /** Average per-move accuracy, 0 to 100, for each color with analyzed moves. */
  accuracy: { white?: number; black?: number };
  evaluation: Array<{ ply: number; whiteWinChance: number }>;
}

/** A position from a finished game where the player went wrong, to try again. */
export interface PracticePosition {
  moveId: string;
  fen: string;
  mover: Color;
  playedSan: string;
  verdict: Verdict;
  bestSan?: string;
}

export interface PracticeResult {
  solved: boolean;
  san: string;
  explanation: string;
}

export type MistakePattern =
  | "allowed-mate"
  | "missed-mate"
  | "left-undefended"
  | "attacked-by-cheaper"
  | "allowed-capture"
  | "missed-capture"
  | "other";

export interface PlayerPatterns {
  name: string;
  games: number;
  mistakes: number;
  patterns: Array<{ id: MistakePattern; label: string; advice: string; count: number; share: number }>;
}

export interface ProviderStatus {
  available: boolean;
  authMode?: string;
  planType?: string;
  model?: string;
  rateLimitsAvailable?: boolean;
  error?: string;
}

export type ServerEvent =
  | { type: "game.updated"; game: GameState }
  | { type: "game.deleted"; gameId: string }
  | { type: "analysis.updated"; gameId: string; moveId: string; analysis: AnalysisRecord }
  | { type: "coaching.updated"; gameId: string; moveId: string; coaching: CoachingRecord }
  | { type: "provider.updated"; provider: ProviderStatus };
