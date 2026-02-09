export type Stone = {
  player: 'B' | 'W';
  x: number | null;
  y: number | null;
  isPass: boolean;
};

export type GameStatePayload = {
  boardSize: number;
  rules: string;
  komi: number;
  handicap: number;
  initialStones: Stone[];
  moves: Stone[];
  currentPlayer: 'B' | 'W';
};

export type AnalysisMoveInfo = {
  move: string;
  order: number;
  visits: number;
  prior: number;
  weight: number;
  scoreLead: number;
  winrate: number;
  pv: string[];
};

export type AnalysisFrame = {
  timestamp: number;
  moveNumber: number;
  isDuringSearch: boolean;
  rootInfo: { visits?: number; winrate?: number; scoreLead?: number };
  moveInfos: AnalysisMoveInfo[];
  ownership: number[];
  policy: number[];
};
