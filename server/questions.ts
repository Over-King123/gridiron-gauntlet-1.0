import fs from "node:fs";
import path from "node:path";
import type { Difficulty, League, LeagueMode, Question } from "../shared/types.ts";
import { GAME_CONFIG } from "./config.ts";

export type Rng = () => number;

const LEAGUES: League[] = ["NFL", "FBS"];

/** Validate one raw question object; returns a list of problems (empty = valid). */
export function validateQuestion(q: any): string[] {
  const errs: string[] = [];
  if (!q || typeof q !== "object") return ["not an object"];
  if (typeof q.id !== "string" || !q.id) errs.push("missing id");
  if (!LEAGUES.includes(q.league)) errs.push(`bad league ${q.league}`);
  if (typeof q.category !== "string" || !q.category) errs.push("missing category");
  if (![1, 2, 3].includes(q.difficulty)) errs.push(`bad difficulty ${q.difficulty}`);
  if (typeof q.question !== "string" || q.question.length < 10) errs.push("question too short");
  if (!Array.isArray(q.answers) || q.answers.length !== 4) errs.push("needs exactly 4 answers");
  else {
    if (q.answers.some((a: any) => typeof a !== "string" || !a.trim())) errs.push("empty answer");
    const norm = q.answers.map((a: string) => String(a).trim().toLowerCase());
    if (new Set(norm).size !== 4) errs.push("duplicate answers");
  }
  if (![0, 1, 2, 3].includes(q.correctIndex)) errs.push("bad correctIndex");
  if (typeof q.explanation !== "string" || !q.explanation) errs.push("missing explanation");
  return errs;
}

/** Load every *.json file in a directory. Each file holds an array of questions. Throws on any invalid question. */
export function loadQuestionBank(dir: string): Question[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const all: Question[] = [];
  const ids = new Set<string>();
  const problems: string[] = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!Array.isArray(raw)) throw new Error(`${f}: expected an array`);
    for (const q of raw) {
      const errs = validateQuestion(q);
      if (ids.has(q?.id)) errs.push("duplicate id");
      if (errs.length) problems.push(`${f} ${q?.id ?? "?"}: ${errs.join(", ")}`);
      else {
        ids.add(q.id);
        all.push(q as Question);
      }
    }
  }
  if (problems.length) throw new Error("Invalid questions:\n" + problems.join("\n"));
  return all;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick questions for one game. Regular questions follow the difficulty mix;
 * the final question is the hardest available tier. Questions in `used` are
 * avoided while enough fresh ones remain.
 */
export const isClassic = (q: Question) => !!q.tags?.includes("classic");

export function selectQuestions(
  bank: Question[],
  mode: LeagueMode,
  used: Set<string>,
  rng: Rng,
  total = GAME_CONFIG.questionsPerGame,
  mix = GAME_CONFIG.regularMix,
  maxClassic = GAME_CONFIG.maxClassicPerGame,
): Question[] {
  const leagues: League[] = mode === "MIXED" ? ["NFL", "FBS"] : [mode];
  const eligible = bank.filter((q) => leagues.includes(q.league));
  if (eligible.length < total) throw new Error(`Not enough ${mode} questions (${eligible.length})`);

  const picked: Question[] = [];
  const pickedIds = new Set<string>();

  // take n from a filtered pool, fresh first, then previously-used, balancing leagues in MIXED
  let classics = 0;
  const take = (filter: (q: Question) => boolean, n: number) => {
    const pool = eligible.filter((q) => filter(q) && !pickedIds.has(q.id) && (!isClassic(q) || classics < maxClassic));
    const fresh = shuffle(pool.filter((q) => !used.has(q.id)), rng);
    const stale = shuffle(pool.filter((q) => used.has(q.id)), rng);
    const ordered = [...fresh, ...stale];
    const out: Question[] = [];
    if (leagues.length === 2) {
      // alternate leagues so MIXED is roughly half/half
      let turn: League = rng() < 0.5 ? "NFL" : "FBS";
      while (out.length < n) {
        let idx = ordered.findIndex((q) => q.league === turn && !out.includes(q));
        if (idx === -1) idx = ordered.findIndex((q) => !out.includes(q));
        if (idx === -1) break;
        out.push(ordered[idx]);
        turn = turn === "NFL" ? "FBS" : "NFL";
      }
    } else {
      out.push(...ordered.slice(0, n));
    }
    // enforce the classic cap within this batch too
    const capped: Question[] = [];
    for (const q of out) {
      if (isClassic(q)) {
        if (classics >= maxClassic) continue;
        classics++;
      }
      capped.push(q);
      pickedIds.add(q.id);
    }
    if (capped.length < out.length && capped.length < n) capped.push(...take((q) => filter(q) && !isClassic(q), n - capped.length));
    return capped;
  };

  // final question: hardest tier available
  const finalQ =
    take((q) => q.difficulty === 3, 1)[0] ??
    take((q) => q.difficulty === 2, 1)[0] ??
    take(() => true, 1)[0];

  const regularCount = total - 1;
  const scaled = mix.map((m) => Math.round((m / (mix[0] + mix[1] + mix[2])) * regularCount));
  scaled[0] += regularCount - (scaled[0] + scaled[1] + scaled[2]);
  for (let d = 3 as Difficulty; d >= 1; d = (d - 1) as Difficulty) {
    picked.push(...take((q) => q.difficulty === d, scaled[d - 1]));
    if (d === 1) break;
  }
  // backfill if a tier ran short
  if (picked.length < regularCount) picked.push(...take(() => true, regularCount - picked.length));

  // gentle ramp: shuffle, then stable-sort so harder questions drift later
  const ordered = shuffle(picked, rng)
    .map((q, i) => ({ q, key: i + (q.difficulty - 1) * 4 + rng() * 3 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.q);
  return [...ordered, finalQ];
}

// ---------------- dated Daily sets (content/daily/YYYY-MM-DD.json) ----------------

export const DAILY_MIX = [3, 4, 3] as const;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function similarity(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 3));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 3));
  // too few meaningful words to judge overlap; only exact matches count
  if (Math.min(A.size, B.size) < 4) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}

/** Problems with one day's hand-written set: shape, mix, classic cap, duplicates of earlier questions. */
export function validateDailySet(date: string, set: Question[], others: Question[]): string[] {
  const errs: string[] = [];
  if (set.length !== 10) errs.push(`${date}: needs exactly 10 questions, has ${set.length}`);
  const tiers = [1, 2, 3].map((d) => set.filter((q) => q.difficulty === d).length);
  if (tiers.join() !== DAILY_MIX.join()) errs.push(`${date}: difficulty mix ${tiers.join("/")} should be ${DAILY_MIX.join("/")}`);
  if (set.filter(isClassic).length > 1) errs.push(`${date}: more than one classic question`);
  const leagues = new Set(set.map((q) => q.league));
  if (leagues.size < 2) errs.push(`${date}: should mix NFL and FBS`);
  for (const q of set) {
    for (const o of others) {
      if (o.id === q.id) continue;
      if (norm(o.question) === norm(q.question) || similarity(o.question, q.question) >= 0.8)
        errs.push(`${date} ${q.id}: too similar to ${o.id} ("${o.question.slice(0, 60)}")`);
    }
  }
  return errs;
}

/** Load content/daily/*.json. Throws if any file is invalid. */
export function loadDailySets(dir: string, base: Question[]): Map<string, Question[]> {
  const sets = new Map<string, Question[]>();
  if (!fs.existsSync(dir)) return sets;
  const ids = new Set(base.map((q) => q.id));
  const problems: string[] = [];
  const all: Question[] = [...base];
  for (const f of fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    const date = f.slice(0, 10);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!Array.isArray(raw)) {
      problems.push(`${f}: expected an array`);
      continue;
    }
    for (const q of raw) {
      const errs = validateQuestion(q);
      if (ids.has(q?.id)) errs.push("duplicate id");
      if (errs.length) problems.push(`${f} ${q?.id ?? "?"}: ${errs.join(", ")}`);
      ids.add(q?.id);
    }
    problems.push(...validateDailySet(date, raw, all));
    all.push(...raw);
    // play order: easy -> hard
    sets.set(date, (raw as Question[]).slice().sort((a, b) => a.difficulty - b.difficulty));
  }
  if (problems.length) throw new Error("Invalid daily sets:\n" + problems.join("\n"));
  return sets;
}

/** Everything multiplayer may draw from: the base bank plus Daily sets from days already past. */
export function multiplayerPool(base: Question[], sets: Map<string, Question[]>, today: string): Question[] {
  const out = base.slice();
  for (const [date, qs] of sets) if (date < today) out.push(...qs);
  return out;
}
