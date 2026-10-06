import path from "node:path";
import { describe, expect, it } from "vitest";
import { Daily, dailyQuestions, dateKey, dayNumber, msUntilReset } from "./daily.ts";
import { isClassic, loadQuestionBank, validateDailySet } from "./questions.ts";
import { MemoryKV } from "./store.ts";

const bank = loadQuestionBank(path.resolve("content/questions"));
// 2026-10-07 15:00 UTC = 10:00 Central (CDT)
const T = Date.parse("2026-10-07T15:00:00Z");
const DEV = "device-abcdefghijklmnop";

describe("daily dates", () => {
  it("uses Central time for the day boundary", () => {
    expect(dateKey(Date.parse("2026-10-08T04:59:00Z"))).toBe("2026-10-07"); // 11:59pm CDT
    expect(dateKey(Date.parse("2026-10-08T05:00:00Z"))).toBe("2026-10-08"); // midnight CDT
    expect(dayNumber("2026-10-06")).toBe(1);
    expect(dayNumber("2026-10-07")).toBe(2);
    expect(msUntilReset(Date.parse("2026-10-08T04:00:00Z"))).toBe(3_600_000);
  });
});

describe("daily schedule", () => {
  it("gives the same 10 questions to everyone, easy to hard, mixed leagues", () => {
    const a = dailyQuestions(bank, "2026-10-07");
    const b = dailyQuestions(bank, "2026-10-07");
    expect(a.map((x) => x.q.id)).toEqual(b.map((x) => x.q.id));
    expect(a.map((x) => x.answers)).toEqual(b.map((x) => x.answers));
    expect(a).toHaveLength(10);
    expect(a.map((x) => x.q.difficulty)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
    for (const x of a) expect(x.answers[x.correctIndex]).toBe(x.q.answers[x.q.correctIndex]);
  });
  it("doesn't repeat questions across consecutive days", () => {
    const seen = new Set<string>();
    // 9 straight days of fallback schedule with no repeats
    for (let d = 0; d < 9; d++) {
      const date = new Date(Date.parse("2026-10-06T12:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
      for (const x of dailyQuestions(bank, date)) {
        expect(seen.has(x.q.id), `${x.q.id} repeated on ${date}`).toBe(false);
        seen.add(x.q.id);
      }
    }
  });
});

describe("daily attempts", () => {
  it("plays through, scores X/10, one attempt per device, resumes on refresh", async () => {
    let now = T;
    const kv = new MemoryKV(() => now);
    const daily = new Daily(bank, kv, () => now);
    const qs = dailyQuestions(bank, "2026-10-07");

    const s = await daily.start(DEV);
    expect(s.number).toBe(2);
    expect(s.current?.index).toBe(0);
    expect(JSON.stringify(s)).not.toContain("correctIndex"); // nothing leaks before answering

    let st = s;
    for (let i = 0; i < 10; i++) {
      now += 5000;
      const choice = i < 7 ? qs[i].correctIndex : (qs[i].correctIndex + 1) % 4;
      st = await daily.answer(s.date, s.attemptId, i, choice);
      expect(st.history[i].correct).toBe(i < 7);
      if (i === 3) {
        // refresh mid-game: same attempt, same position
        const again = await daily.start(DEV);
        expect(again.attemptId).toBe(s.attemptId);
        expect(again.current?.index).toBe(4);
        await expect(daily.answer(s.date, s.attemptId, 2, 0)).rejects.toThrow(/already answered/);
      }
    }
    expect(st.finished).toBe(true);
    expect(st.score).toBe(7);
    expect(st.timeMs).toBe(50_000);
    await expect(daily.answer(s.date, s.attemptId, 10, 0)).rejects.toThrow(/finished/);

    // same device can't start over
    const replay = await daily.start(DEV);
    expect(replay.finished).toBe(true);
    expect(replay.attemptId).toBe(s.attemptId);
  });

  it("ranks the board by score, then time; board is per day", async () => {
    let now = T;
    const kv = new MemoryKV(() => now);
    const daily = new Daily(bank, kv, () => now);
    const qs = dailyQuestions(bank, "2026-10-07");
    const play = async (dev: string, correct: number, stepMs: number, name: string) => {
      const s = await daily.start(dev);
      for (let i = 0; i < 10; i++) {
        now += stepMs;
        await daily.answer(s.date, s.attemptId, i, i < correct ? qs[i].correctIndex : (qs[i].correctIndex + 1) % 4);
      }
      await daily.submitName(s.date, s.attemptId, name);
      return s.attemptId;
    };
    await play("dev-aaaaaaaaaaaaaaaa", 8, 9000, "Slow8");
    const fast = await play("dev-bbbbbbbbbbbbbbbb", 8, 3000, "Fast8");
    await play("dev-cccccccccccccccc", 9, 20000, "Nine");
    const board = await daily.leaderboard(undefined, fast);
    expect(board.entries.map((e) => e.name)).toEqual(["Nine", "Fast8", "Slow8"]);
    expect(board.myRank).toBe(2);
    expect(board.plays).toBe(3);
    await expect(daily.submitName("2026-10-07", fast, "Again")).rejects.toThrow(/already/);

    now = Date.parse("2026-10-08T06:00:00Z"); // next day in Central
    const tomorrow = await daily.leaderboard();
    expect(tomorrow.date).toBe("2026-10-08");
    expect(tomorrow.entries).toHaveLength(0);
    const s2 = await daily.start("dev-aaaaaaaaaaaaaaaa");
    expect(s2.finished).toBe(false); // new day, new attempt
  });

  it("locks the day's questions even if the bank changes mid-day", async () => {
    const kv = new MemoryKV(() => T);
    const first = new Daily(bank, kv, () => T);
    const s = await first.start(DEV);
    const lockedQ = s.current!.question;
    // simulate a mid-day deploy that adds questions, which reshuffles the computed schedule
    const extra = Array.from({ length: 40 }, (_, i) => ({ ...bank[0], id: `zz-new-${i}`, difficulty: ((i % 3) + 1) as 1 | 2 | 3, question: `New question ${i}?` }));
    const later = new Daily([...bank, ...extra], kv, () => T);
    const again = await later.start(DEV);
    expect(again.current!.question).toBe(lockedQ);
  });
});

describe("classics and dated sets", () => {
  it("never puts more than one classic question in a fallback daily", () => {
    for (let d = 0; d < 60; d++) {
      const date = new Date(Date.parse("2026-10-06T12:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
      expect(dailyQuestions(bank, date).filter((x) => isClassic(x.q)).length).toBeLessThanOrEqual(1);
    }
  });

  it("uses a dated set when one exists, in easy-to-hard order", async () => {
    const mk = (i: number, d: 1 | 2 | 3, league: "NFL" | "FBS") => ({
      id: `d-test-${i}`,
      league,
      category: "test",
      difficulty: d,
      question: `Brand new player question number ${i} about someone?`,
      answers: ["Right", "Wrong A", "Wrong B", "Wrong C"] as [string, string, string, string],
      correctIndex: 0 as const,
      explanation: "x",
    });
    const set = [3, 3, 3, 2, 2, 2, 2, 1, 1, 1].map((d, i) => mk(i, d as 1 | 2 | 3, i % 2 ? "NFL" : "FBS"));
    expect(validateDailySet("2026-10-07", set, bank)).toEqual([]);
    const sorted = set.slice().sort((a, b) => a.difficulty - b.difficulty);
    const daily = new Daily(bank, new MemoryKV(() => T), () => T, undefined, new Map([["2026-10-07", sorted]]));
    const s = await daily.start(DEV);
    expect(s.current!.question).toBe(sorted[0].question);
  });

  it("flags bad dated sets: wrong mix, duplicates of existing questions", () => {
    const dup = { ...bank[0], id: "d-dup" };
    const errs = validateDailySet("2026-10-07", [dup], bank);
    expect(errs.join(" ")).toMatch(/exactly 10/);
    expect(errs.join(" ")).toMatch(/too similar/);
  });
});

describe("stale locks", () => {
  it("replaces a lock that points at questions no longer in the bank", async () => {
    const kv = new MemoryKV(() => T);
    await kv.set("gg:daily2:2026-10-07:qids", JSON.stringify(["gone-1", "gone-2"]), 3600);
    const daily = new Daily(bank, kv, () => T);
    const s = await daily.start(DEV);
    expect(s.current).not.toBeNull();
    expect(s.total).toBe(10);
  });
});
