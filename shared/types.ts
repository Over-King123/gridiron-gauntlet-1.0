// Shared types between server and client. The server is the only authority;
// these describe what it sends and what it accepts.

export type League = "NFL" | "FBS";
export type LeagueMode = "NFL" | "FBS" | "MIXED";
export type Difficulty = 1 | 2 | 3; // 1 knowledgeable fan, 2 serious fan, 3 deep cut

export interface Question {
  id: string;
  league: League;
  category: string;
  difficulty: Difficulty;
  question: string;
  answers: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  source?: string;
  tags?: string[];
}

export type Phase = "lobby" | "question" | "reveal" | "leaderboard" | "final";

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  answered: boolean; // has answered the current question (never reveals which answer before reveal)
}

/** A question as clients see it during play: no correct answer. */
export interface PublicQuestion {
  id: string;
  number: number; // 1-based
  total: number;
  league: League;
  category: string;
  difficulty: Difficulty;
  question: string;
  answers: string[];
  isFinal: boolean;
  multiplier: number;
}

export interface RevealInfo {
  correctIndex: number;
  explanation: string;
  source?: string;
  /** per player result for this question */
  results: Record<string, { choice: number | null; correct: boolean; points: number }>;
  answerCounts: number[];
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  league: LeagueMode;
  hostId: string;
  players: PublicPlayer[];
  question: PublicQuestion | null;
  /** server epoch ms when the current phase ends (question/reveal/leaderboard) */
  phaseEndsAt: number | null;
  /** server epoch ms when this snapshot was sent, for clock offset */
  serverNow: number;
  questionDurationMs: number;
  reveal: RevealInfo | null;
  /** previous ranking order (player ids) for leaderboard movement animation */
  previousRanking: string[];
  gameNumber: number;
  /** personalised: the receiving player's locked answer for the current question */
  myChoice: number | null;
  /** personalised: the receiving player's id */
  you: string;
}

// ---- socket protocol ----
export interface Ack<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface SessionInfo {
  code: string;
  playerId: string;
  token: string;
}

export interface ClientToServer {
  createRoom: (p: { name: string }, ack: (r: Ack<SessionInfo>) => void) => void;
  joinRoom: (p: { code: string; name: string }, ack: (r: Ack<SessionInfo>) => void) => void;
  resume: (p: SessionInfo, ack: (r: Ack<SessionInfo>) => void) => void;
  setLeague: (p: { league: LeagueMode }, ack: (r: Ack) => void) => void;
  startGame: (p: Record<string, never>, ack: (r: Ack) => void) => void;
  submitAnswer: (p: { questionId: string; choice: number }, ack: (r: Ack) => void) => void;
  playAgain: (p: Record<string, never>, ack: (r: Ack) => void) => void;
  leaveRoom: (p: Record<string, never>, ack: (r: Ack) => void) => void;
  kick: (p: { playerId: string }, ack: (r: Ack) => void) => void;
}

export interface ServerToClient {
  state: (s: RoomSnapshot) => void;
  kicked: () => void;
}
