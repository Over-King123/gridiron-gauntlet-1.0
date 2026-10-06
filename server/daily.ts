import crypto from "node:crypto";
import type { Question } from "../shared/types.ts";
import type { KV } from "./store.ts";
import { cleanName } from "./room.ts";

// ---------------- configuration ----------------

export const DAILY_CONFIG = {
  timeZone: "America/Chicago",
  /** Daily #1 */
  epoch: "2026-10-06",
  /** questions per tier, in play order: easy first, deep cuts last */
  mix: [3, 4, 3] as [number, number, number],
  /** bump to reshuffle the whole schedule */
  seed: "gg-daily-v1",
  ttlSec: 3 * 24 * 3600,
  nameMaxLength: 16,
};

/**
 * Themed days: date -> { name, tag }. On a themed day, questions are drawn from
 * questions carrying that tag (falling back to the normal pool if a tier runs short).
 * Example: { "2026-11-07": { name: "SEC Saturday", tag: "SEC" } }
 */
export const DAILY_THEMES: Record<string, { name: string; tag: string }> = {};

// ---------------- dates ----------------

function zonedParts(now: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

export function dateKey(now: number, tz = DAILY_CONFIG.timeZone): string {
  const p = zonedParts(now, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function dayNumber(date: string, epoch = DAILY_CONFIG.epoch): number {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(epoch + "T00:00:00Z")) / 86_400_000) + 1;
}

/** ms until the next local midnight (DST-safe enough: re-checked by clients on every load) */
export function msUntilReset(now: number, tz = DAILY_CONFIG.timeZone): number {
  const p = zonedParts(now, tz);
  const elapsed = ((p.h * 60 + p.min) * 60 + p.s) * 1000 + (now % 1000);
  return 86_400_000 - elapsed;
}

// ---------------- question schedule ----------------

function h(s: string): number {
  return crypto.createHash("sha256").update(s).digest().readUInt32BE(0);
}

export interface DailyQuestion {
  q: Question;
  answers: string[];
  correctIndex: number;
}

/**
 * Deterministic: every player gets the same 10 questions on the same day.
 * Each tier is put in a fixed pseudo-random order and consumed day by day,
 * so questions don't repeat until a tier has been used up.
 */
export function dailyQuestions(bank: Question[], date: string, cfg = DAILY_CONFIG): DailyQuestion[] {
  const day = dayNumber(date, cfg.epoch);
  const theme = DAILY_THEMES[date];
  const picked: Question[] = [];
  for (let tier = 1; tier <= 3; tier++) {
    const want = cfg.mix[tier - 1];
    const order = (pool: Question[]) => pool.slice().sort((a, b) => h(cfg.seed + a.id) - h(cfg.seed + b.id) || (a.id < b.id ? -1 : 1));
    const all = order(bank.filter((q) => q.difficulty === tier));
    let chosen: Question[] = [];
    if (theme) {
      const themed = all.filter((q) => q.tags?.includes(theme.tag));
      const start = ((day - 1) * want) % Math.max(1, themed.length);
      for (let i = 0; i < Math.min(want, themed.length); i++) chosen.push(themed[(start + i) % themed.length]);
    }
    const start = ((day - 1) * want) % all.length;
    for (let i = 0; chosen.length < want && i < all.length; i++) {
      const q = all[(start + i) % all.length];
      if (!chosen.includes(q)) chosen.push(q);
    }
    picked.push(...chosen);
  }
  return picked.map((q) => withAnswerOrder(q, date));
}

function withAnswerOrder(q: Question, date: string): DailyQuestion {
  const order = [0, 1, 2, 3].sort((a, b) => h(`${date}:${q.id}:${a}`) - h(`${date}:${q.id}:${b}`));
  return { q, answers: order.map((i) => q.answers[i]), correctIndex: order.indexOf(q.correctIndex) };
}

// ---------------- attempts + leaderboard ----------------

export class DailyError extends Error {}

interface Attempt {
  id: string;
  date: string;
  startedAt: number;
  finishedAt: number | null;
  /** 1 = correct, 0 = wrong, per answered question */
  marks: number[];
  choices: number[];
  name: string | null;
}

export interface BoardEntry {
  name: string;
  score: number;
  timeMs: number;
  finishedAt: number;
  marks: string;
}

export interface PublicDailyQuestion {
  index: number; // 0-based
  question: string;
  answers: string[];
}

export interface DailyState {
  date: string;
  number: number;
  total: number;
  theme: string | null;
  resetInMs: number;
  attemptId: string;
  /** answered so far, with feedback, so a refresh can rebuild the screen */
  history: { question: string; answers: string[]; choice: number; correctIndex: number; correct: boolean; explanation: string }[];
  current: PublicDailyQuestion | null;
  finished: boolean;
  score: number;
  timeMs: number | null;
  submittedName: string | null;
}

const k = {
  attempt: (date: string, id: string) => `gg:daily:${date}:attempt:${id}`,
  device: (date: string, dev: string) => `gg:daily:${date}:device:${dev}`,
  board: (date: string) => `gg:daily:${date}:board`,
  plays: (date: string) => `gg:daily:${date}:plays`,
  qids: (date: string) => `gg:daily:${date}:qids`,
};

export class Daily {
  constructor(
    private bank: Question[],
    private kv: KV,
    private now: () => number = Date.now,
    private cfg = DAILY_CONFIG,
  ) {}

  private today() {
    return dateKey(this.now(), this.cfg.timeZone);
  }

  /**
   * The day's 10 question ids are locked in storage the first time that day is requested,
   * so pushing question changes mid-day never swaps questions under someone mid-attempt.
   */
  private async questionsFor(date: string): Promise<DailyQuestion[]> {
    const key = k.qids(date);
    const stored = await this.kv.get(key);
    if (stored) {
      const ids: string[] = JSON.parse(stored);
      const byId = new Map(this.bank.map((q) => [q.id, q]));
      if (ids.every((id) => byId.has(id))) return ids.map((id) => withAnswerOrder(byId.get(id)!, date));
    }
    const qs = dailyQuestions(this.bank, date, this.cfg);
    const ids = JSON.stringify(qs.map((x) => x.q.id));
    if (!(await this.kv.setNX(key, ids, this.cfg.ttlSec))) {
      const winner = await this.kv.get(key);
      if (winner && winner !== ids) return this.questionsFor(date);
    }
    return qs;
  }

  private async load(date: string, id: string): Promise<Attempt> {
    const raw = await this.kv.get(k.attempt(date, id));
    if (!raw) throw new DailyError("That attempt has expired");
    return JSON.parse(raw);
  }

  private async save(a: Attempt) {
    await this.kv.set(k.attempt(a.date, a.id), JSON.stringify(a), this.cfg.ttlSec);
  }

  private async view(a: Attempt): Promise<DailyState> {
    const qs = await this.questionsFor(a.date);
    const i = a.marks.length;
    const cur = !a.finishedAt && qs[i] ? { index: i, question: qs[i].q.question, answers: qs[i].answers } : null;
    return {
      date: a.date,
      number: dayNumber(a.date, this.cfg.epoch),
      total: qs.length,
      theme: DAILY_THEMES[a.date]?.name ?? null,
      resetInMs: msUntilReset(this.now(), this.cfg.timeZone),
      attemptId: a.id,
      history: a.marks.map((m, j) => ({
        question: qs[j].q.question,
        answers: qs[j].answers,
        choice: a.choices[j],
        correctIndex: qs[j].correctIndex,
        correct: m === 1,
        explanation: qs[j].q.explanation,
      })),
      current: cur,
      finished: !!a.finishedAt,
      score: a.marks.reduce((s, m) => s + m, 0),
      timeMs: a.finishedAt ? a.finishedAt - a.startedAt : null,
      submittedName: a.name,
    };
  }

  /** Start or resume today's attempt for this device. One attempt per device per day. */
  async start(deviceId: string): Promise<DailyState> {
    const dev = String(deviceId ?? "");
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(dev)) throw new DailyError("Bad device id");
    const date = this.today();
    const fresh: Attempt = {
      id: crypto.randomBytes(16).toString("base64url"),
      date,
      startedAt: this.now(),
      finishedAt: null,
      marks: [],
      choices: [],
      name: null,
    };
    const claimed = await this.kv.setNX(k.device(date, dev), fresh.id, this.cfg.ttlSec);
    if (claimed) {
      await this.save(fresh);
      return this.view(fresh);
    }
    const existing = await this.kv.get(k.device(date, dev));
    return this.view(await this.load(date, existing!));
  }

  /** Re-fetch an attempt (for a refresh mid-game or after midnight). */
  async get(date: string, attemptId: string): Promise<DailyState> {
    return this.view(await this.load(String(date), String(attemptId)));
  }

  async answer(date: string, attemptId: string, index: number, choice: number) {
    const a = await this.load(String(date), String(attemptId));
    if (a.finishedAt) throw new DailyError("You've already finished today's Gauntlet");
    if (index !== a.marks.length) throw new DailyError("That question is already answered");
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw new DailyError("Invalid answer");
    const qs = await this.questionsFor(a.date);
    const q = qs[index];
    const correct = choice === q.correctIndex;
    a.marks.push(correct ? 1 : 0);
    a.choices.push(choice);
    if (a.marks.length === qs.length) {
      a.finishedAt = this.now();
      await this.kv.incr(k.plays(a.date), this.cfg.ttlSec);
    }
    await this.save(a);
    return this.view(a);
  }

  async submitName(date: string, attemptId: string, rawName: string) {
    const a = await this.load(String(date), String(attemptId));
    if (!a.finishedAt) throw new DailyError("Finish all 10 first");
    if (a.name) throw new DailyError("You're already on today's board");
    const name = cleanName(rawName, this.cfg.nameMaxLength);
    if (!name) throw new DailyError("Enter a display name");
    a.name = name;
    const entry: BoardEntry = {
      name,
      score: a.marks.reduce((s, m) => s + m, 0),
      timeMs: a.finishedAt - a.startedAt,
      finishedAt: a.finishedAt,
      marks: a.marks.join(""),
    };
    await this.save(a);
    await this.kv.hset(k.board(a.date), a.id, JSON.stringify(entry), this.cfg.ttlSec);
    return this.view(a);
  }

  /** Ranked board: most correct, then fastest total time, then earliest finish. */
  async leaderboard(date?: string, attemptId?: string) {
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : this.today();
    const raw = await this.kv.hgetall(k.board(d));
    const rows = Object.entries(raw)
      .map(([id, v]) => ({ id, ...(JSON.parse(v) as BoardEntry) }))
      .sort((a, b) => b.score - a.score || a.timeMs - b.timeMs || a.finishedAt - b.finishedAt);
    const plays = Number((await this.kv.get(k.plays(d))) ?? 0);
    const myRank = attemptId ? rows.findIndex((r) => r.id === attemptId) + 1 || null : null;
    return {
      date: d,
      number: dayNumber(d, this.cfg.epoch),
      resetInMs: msUntilReset(this.now(), this.cfg.timeZone),
      plays,
      total: rows.length,
      myRank,
      entries: rows.slice(0, 100).map(({ id, ...r }, i) => ({ rank: i + 1, ...r, me: id === attemptId })),
    };
  }
}
