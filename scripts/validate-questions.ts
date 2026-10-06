import path from "node:path";
import { loadDailySets, loadQuestionBank } from "../server/questions.ts";

const bank = loadQuestionBank(path.resolve("content/questions"));
const sets = loadDailySets(path.resolve("content/daily"), bank);
const by: Record<string, number> = {};
for (const q of bank) by[`${q.league} d${q.difficulty}`] = (by[`${q.league} d${q.difficulty}`] ?? 0) + 1;
console.log(`${bank.length} valid base questions`, by);
console.log(`${sets.size} valid daily sets: ${[...sets.keys()].join(", ") || "none"}`);
