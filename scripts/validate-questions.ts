import path from "node:path";
import { loadQuestionBank } from "../server/questions.ts";

const bank = loadQuestionBank(path.resolve("content/questions"));
const by: Record<string, number> = {};
for (const q of bank) by[`${q.league} d${q.difficulty}`] = (by[`${q.league} d${q.difficulty}`] ?? 0) + 1;
console.log(`${bank.length} valid questions`, by);
