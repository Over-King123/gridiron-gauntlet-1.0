// Chooses the question for a day's Instagram reel and writes its caption.
// The reel always uses a question from YESTERDAY's Daily, so it never spoils today's game.

import crypto from "node:crypto";
import path from "node:path";
import type { Question } from "../../shared/types.ts";
import { seasonFor, weeklyTheme, type Season } from "../../shared/themes.ts";
import { dailyQuestions, dayNumber, themeInfo } from "../../server/daily.ts";
import { loadDailySets, loadQuestionBank } from "../../server/questions.ts";

export const SITE_URL = "https://gridiron-gauntlet.onrender.com";

export interface ReelPlan {
  /** the day the reel is posted (America/Chicago) */
  date: string;
  /** the Daily the question comes from (the day before) */
  sourceDate: string;
  dailyNumber: number;
  theme: string | null;
  season: Season | null;
  hook: string;
  question: string;
  answers: string[];
  correctIndex: number;
  explanation: string;
  questionId: string;
  caption: string;
}

const h = (s: string) => crypto.createHash("sha256").update(s).digest().readUInt32BE(0);

export const HOOKS = [
  "Only real ball knowers get this one",
  "You've got 5 seconds. Go.",
  "Diehards only. Can you get it?",
  "Tag the friend who gets this wrong",
  "Be honest: did you know this?",
  "No googling. Lock in your answer.",
];

export function previousDay(date: string): string {
  return new Date(Date.parse(date + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
}

/** Readable on a phone in a few seconds: not too long, short answer options, no classics. */
function reelFriendly(q: Question): boolean {
  return q.question.length <= 160 && q.answers.every((a) => a.length <= 26) && !q.tags?.includes("classic");
}

/** Picks a medium question (falling back to any tier), preferring ones that read well on screen. */
export function pickQuestion(set: Question[], date: string): Question {
  const byPref = [
    set.filter((q) => q.difficulty === 2 && reelFriendly(q)),
    set.filter((q) => reelFriendly(q)),
    set,
  ].find((pool) => pool.length)!;
  return byPref.slice().sort((a, b) => h(date + a.id) - h(date + b.id))[0];
}

function shuffledAnswers(q: Question, date: string) {
  const order = [0, 1, 2, 3].sort((a, b) => h(`reel:${date}:${q.id}:${a}`) - h(`reel:${date}:${q.id}:${b}`));
  return { answers: order.map((i) => q.answers[i]), correctIndex: order.indexOf(q.correctIndex) };
}

export function buildCaption(p: Omit<ReelPlan, "caption">): string {
  const letters = ["A", "B", "C", "D"];
  const today = p.theme ? `Today's Daily Gauntlet #${p.dailyNumber} (${p.theme}) is live.` : `Today's Daily Gauntlet #${p.dailyNumber} is live.`;
  return [
    p.hook,
    "",
    p.question,
    ...p.answers.map((a, i) => `${letters[i]}) ${a}`),
    "",
    "Answer at the end of the reel. Drop your guess in the comments 👇",
    "",
    `${today} 10 questions, one shot, free. Link in bio 🏈`,
    "",
    "#footballtrivia #nfl #collegefootball #cfb #nfltrivia #sportstrivia #trivia #dailypuzzle #gridirongauntlet",
  ].join("\n");
}

export function planReel(date: string, root = process.cwd()): ReelPlan {
  const bank = loadQuestionBank(path.join(root, "content", "questions"));
  const sets = loadDailySets(path.join(root, "content", "daily"), bank);
  const sourceDate = previousDay(date);
  const set = sets.get(sourceDate) ?? dailyQuestions(bank, sourceDate).map((x) => x.q);
  const q = pickQuestion(set, date);
  const { answers, correctIndex } = shuffledAnswers(q, date);
  const base = {
    date,
    sourceDate,
    dailyNumber: dayNumber(date),
    theme: themeInfo(date)?.name ?? weeklyTheme(date)?.name ?? null,
    season: seasonFor(date),
    hook: HOOKS[h("hook:" + date) % HOOKS.length],
    question: q.question,
    answers,
    correctIndex,
    explanation: q.explanation,
    questionId: q.id,
  };
  return { ...base, caption: buildCaption(base) };
}
