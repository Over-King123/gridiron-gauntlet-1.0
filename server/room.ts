import crypto from "node:crypto";
import type {
  LeagueMode,
  Phase,
  PublicPlayer,
  PublicQuestion,
  Question,
  RevealInfo,
  RoomSnapshot,
} from "../shared/types.ts";
import { GAME_CONFIG, scoreAnswer, type GameConfig } from "./config.ts";
import { selectQuestions, shuffle, type Rng } from "./questions.ts";

/** Time + timers are injected so the engine can be tested deterministically. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface Player {
  id: string;
  token: string;
  name: string;
  score: number;
  connected: boolean;
  joinedAt: number;
  connectedSince: number;
  /** total ms taken on correct answers (tie-breaker; lower is better) */
  correctTimeMs: number;
  correctCount: number;
}

interface LiveQuestion {
  q: Question;
  answers: string[]; // shuffled order, same for everyone
  correctIndex: number; // index into shuffled answers
  number: number;
  multiplier: number;
  startedAt: number;
  deadline: number;
}

interface Submission {
  choice: number;
  elapsedMs: number;
}

export class GameError extends Error {}

export class Room {
  readonly code: string;
  phase: Phase = "lobby";
  league: LeagueMode = "MIXED";
  hostId: string;
  players = new Map<string, Player>();
  lastActivity: number;
  gameNumber = 0;

  private questions: Question[] = [];
  private current: LiveQuestion | null = null;
  private submissions = new Map<string, Submission>();
  private reveal: RevealInfo | null = null;
  private phaseEndsAt: number | null = null;
  private timer: unknown = null;
  private hostTimer: unknown = null;
  private usedQuestionIds = new Set<string>();
  private previousRanking: string[] = [];

  constructor(
    code: string,
    private bank: Question[],
    private onChange: (room: Room) => void,
    private clock: Clock = realClock,
    private rng: Rng = Math.random,
    private cfg: GameConfig = GAME_CONFIG,
  ) {
    this.code = code;
    this.hostId = "";
    this.lastActivity = clock.now();
  }

  // ---------- players ----------

  addPlayer(rawName: string): Player {
    const name = cleanName(rawName, this.cfg.nameMaxLength);
    if (!name) throw new GameError("Enter a display name");
    if (this.players.size >= this.cfg.maxPlayers) throw new GameError("Room is full");
    const lower = name.toLowerCase();
    for (const p of this.players.values())
      if (p.name.toLowerCase() === lower) throw new GameError("That name is taken in this room");
    const now = this.clock.now();
    const p: Player = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(18).toString("base64url"),
      name,
      score: 0,
      connected: true,
      joinedAt: now,
      connectedSince: now,
      correctTimeMs: 0,
      correctCount: 0,
    };
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    this.touch();
    return p;
  }

  /** Reattach a returning player (refresh / network drop). Returns null if token doesn't match. */
  resume(playerId: string, token: string): Player | null {
    const p = this.players.get(playerId);
    if (!p || !safeEqual(p.token, token)) return null;
    if (!p.connected) {
      p.connected = true;
      p.connectedSince = this.clock.now();
    }
    if (this.hostId === p.id && this.hostTimer) {
      this.clock.clearTimeout(this.hostTimer);
      this.hostTimer = null;
    }
    this.touch();
    return p;
  }

  setConnected(playerId: string, connected: boolean) {
    const p = this.players.get(playerId);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    if (connected) p.connectedSince = this.clock.now();
    if (!connected && p.id === this.hostId) this.scheduleHostHandoff();
    if (!connected) this.checkAllAnswered();
    this.touch();
  }

  removePlayer(playerId: string) {
    if (!this.players.delete(playerId)) return;
    this.submissions.delete(playerId);
    if (playerId === this.hostId) this.assignNewHost();
    this.checkAllAnswered();
    this.touch();
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  private scheduleHostHandoff() {
    if (this.hostTimer) this.clock.clearTimeout(this.hostTimer);
    this.hostTimer = this.clock.setTimeout(() => {
      this.hostTimer = null;
      const host = this.players.get(this.hostId);
      if (!host || !host.connected) {
        this.assignNewHost();
        this.emit();
      }
    }, this.cfg.hostGraceMs);
  }

  private assignNewHost() {
    const candidates = [...this.players.values()]
      .filter((p) => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const next = candidates[0] ?? [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.hostId = next?.id ?? "";
  }

  private requireHost(playerId: string) {
    if (playerId !== this.hostId) throw new GameError("Only the host can do that");
  }

  // ---------- game flow ----------

  setLeague(playerId: string, league: LeagueMode) {
    this.requireHost(playerId);
    if (this.phase !== "lobby") throw new GameError("Game already started");
    if (!["NFL", "FBS", "MIXED"].includes(league)) throw new GameError("Unknown league");
    this.league = league;
    this.touch();
  }

  startGame(playerId: string) {
    this.requireHost(playerId);
    if (this.phase !== "lobby") throw new GameError("Game already started");
    if (this.connectedCount() < this.cfg.minPlayersToStart)
      throw new GameError(`Need at least ${this.cfg.minPlayersToStart} players`);
    this.questions = selectQuestions(this.bank, this.league, this.usedQuestionIds, this.rng, this.cfg.questionsPerGame);
    for (const q of this.questions) this.usedQuestionIds.add(q.id);
    for (const p of this.players.values()) {
      p.score = 0;
      p.correctTimeMs = 0;
      p.correctCount = 0;
    }
    this.previousRanking = this.ranking().map((p) => p.id);
    this.gameNumber++;
    this.startQuestion(0);
  }

  /** Host sends everyone back to the lobby after a finished game. */
  playAgain(playerId: string) {
    this.requireHost(playerId);
    if (this.phase !== "final") throw new GameError("Game isn't over yet");
    // drop players who left during the game so the lobby is clean
    for (const p of [...this.players.values()]) if (!p.connected) this.players.delete(p.id);
    if (!this.players.has(this.hostId)) this.assignNewHost();
    this.clearTimer();
    this.phase = "lobby";
    this.current = null;
    this.reveal = null;
    this.phaseEndsAt = null;
    this.submissions.clear();
    for (const p of this.players.values()) p.score = 0;
    this.touch();
  }

  kick(hostId: string, targetId: string) {
    this.requireHost(hostId);
    if (targetId === hostId) throw new GameError("You can't remove yourself");
    this.removePlayer(targetId);
  }

  submitAnswer(playerId: string, questionId: string, choice: number) {
    const p = this.players.get(playerId);
    if (!p) throw new GameError("Not in this room");
    if (this.phase !== "question" || !this.current) throw new GameError("No question is open");
    if (questionId !== this.current.q.id) throw new GameError("That question is closed");
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.current.answers.length)
      throw new GameError("Invalid answer");
    if (this.submissions.has(playerId)) throw new GameError("Answer already locked");
    const now = this.clock.now();
    if (now > this.current.deadline + this.cfg.lateGraceMs) throw new GameError("Time's up");
    this.submissions.set(playerId, {
      choice,
      elapsedMs: Math.max(0, now - this.current.startedAt),
    });
    this.touch();
    this.checkAllAnswered();
  }

  private startQuestion(index: number) {
    const q = this.questions[index];
    const order = shuffle([0, 1, 2, 3], this.rng);
    const now = this.clock.now();
    const isFinal = index === this.questions.length - 1;
    this.current = {
      q,
      answers: order.map((i) => q.answers[i]),
      correctIndex: order.indexOf(q.correctIndex),
      number: index + 1,
      multiplier: isFinal ? this.cfg.finalMultiplier : 1,
      startedAt: now,
      deadline: now + this.cfg.questionDurationMs,
    };
    this.submissions.clear();
    this.reveal = null;
    this.phase = "question";
    this.setPhaseTimer(this.cfg.questionDurationMs + this.cfg.lateGraceMs, () => this.doReveal());
    this.phaseEndsAt = this.current.deadline;
    this.emit();
  }

  private checkAllAnswered() {
    if (this.phase !== "question") return;
    const live = [...this.players.values()].filter((p) => p.connected);
    if (live.length > 0 && live.every((p) => this.submissions.has(p.id))) this.doReveal();
  }

  private doReveal() {
    if (this.phase !== "question" || !this.current) return;
    const cur = this.current;
    this.previousRanking = this.ranking().map((p) => p.id);
    const results: RevealInfo["results"] = {};
    const counts = [0, 0, 0, 0];
    for (const p of this.players.values()) {
      const sub = this.submissions.get(p.id);
      if (!sub) {
        results[p.id] = { choice: null, correct: false, points: 0 };
        continue;
      }
      counts[sub.choice]++;
      const correct = sub.choice === cur.correctIndex;
      const pts = scoreAnswer(correct, sub.elapsedMs, this.cfg.questionDurationMs, cur.multiplier, this.cfg);
      p.score += pts;
      if (correct) {
        p.correctCount++;
        p.correctTimeMs += sub.elapsedMs;
      }
      results[p.id] = { choice: sub.choice, correct, points: pts };
    }
    this.reveal = {
      correctIndex: cur.correctIndex,
      explanation: cur.q.explanation,
      source: cur.q.source,
      results,
      answerCounts: counts,
    };
    this.phase = "reveal";
    const isLast = cur.number === this.questions.length;
    this.setPhaseTimer(this.cfg.revealDurationMs, () => (isLast ? this.finish() : this.showLeaderboard()));
    this.emit();
  }

  private showLeaderboard() {
    this.phase = "leaderboard";
    const next = this.current!.number; // 0-based index of next question
    this.setPhaseTimer(this.cfg.leaderboardDurationMs, () => this.startQuestion(next));
    this.emit();
  }

  private finish() {
    this.clearTimer();
    this.phase = "final";
    this.phaseEndsAt = null;
    this.emit();
  }

  private setPhaseTimer(ms: number, fn: () => void) {
    this.clearTimer();
    this.phaseEndsAt = this.clock.now() + ms;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private clearTimer() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  destroy() {
    this.clearTimer();
    if (this.hostTimer) this.clock.clearTimeout(this.hostTimer);
  }

  // ---------- views ----------

  /** Standings: score desc, then faster total time on correct answers, then join order. */
  ranking(): Player[] {
    return [...this.players.values()].sort(
      (a, b) => b.score - a.score || a.correctTimeMs - b.correctTimeMs || a.joinedAt - b.joinedAt,
    );
  }

  snapshotFor(playerId: string): RoomSnapshot {
    const cur = this.current;
    let question: PublicQuestion | null = null;
    if (cur && this.phase !== "lobby") {
      question = {
        id: cur.q.id,
        number: cur.number,
        total: this.questions.length,
        league: cur.q.league,
        category: cur.q.category,
        difficulty: cur.q.difficulty,
        question: cur.q.question,
        answers: cur.answers,
        isFinal: cur.multiplier > 1,
        multiplier: cur.multiplier,
      };
    }
    const players: PublicPlayer[] = this.ranking().map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      isHost: p.id === this.hostId,
      answered: this.submissions.has(p.id),
    }));
    const showReveal = this.phase === "reveal" || this.phase === "leaderboard" || this.phase === "final";
    return {
      code: this.code,
      phase: this.phase,
      league: this.league,
      hostId: this.hostId,
      players,
      question,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this.clock.now(),
      questionDurationMs: this.cfg.questionDurationMs,
      reveal: showReveal ? this.reveal : null,
      previousRanking: this.previousRanking,
      gameNumber: this.gameNumber,
      myChoice: this.submissions.get(playerId)?.choice ?? this.reveal?.results[playerId]?.choice ?? null,
      you: playerId,
    };
  }

  private touch() {
    this.lastActivity = this.clock.now();
    this.emit();
  }

  private emit() {
    this.onChange(this);
  }
}

export function cleanName(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
