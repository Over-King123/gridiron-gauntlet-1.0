import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIVISIONS, divisionFor, seasonFor, weeklyTheme } from "../shared/themes.ts";
import { dailyQuestions } from "./daily.ts";
import { loadQuestionBank, validateDailySet } from "./questions.ts";
import type { Question } from "../shared/types.ts";

const bank = loadQuestionBank(path.resolve("content/questions"));

const mk = (i: number, d: 1 | 2 | 3, league: "NFL" | "FBS", extra: Partial<Question> = {}): Question => ({
  id: `t-${i}`,
  league,
  category: "test",
  difficulty: d,
  question: `Completely original themed test prompt ${i} zebra${i} quokka${i}?`,
  answers: ["Right", "Wrong A", "Wrong B", "Wrong C"],
  correctIndex: 0,
  explanation: "x",
  ...extra,
});
const tiers = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3] as const;

describe("weekday themes", () => {
  it("maps weekdays to themes and leaves weekends mixed", () => {
    expect(weeklyTheme("2026-10-19")?.key).toBe("nfl"); // Monday
    expect(weeklyTheme("2026-10-20")?.key).toBe("college");
    expect(weeklyTheme("2026-10-14")?.key).toBe("hodgepodge");
    expect(weeklyTheme("2026-10-15")?.key).toBe("throwback");
    expect(weeklyTheme("2026-10-16")?.key).toBe("division");
    expect(weeklyTheme("2026-10-17")).toBeNull(); // Saturday
    expect(weeklyTheme("2026-10-18")).toBeNull(); // Sunday
    expect(weeklyTheme("2026-10-12")).toBeNull(); // before themes started
  });
  it("rotates divisions one per Friday", () => {
    const fridays = Array.from({ length: 9 }, (_, w) => new Date(Date.parse("2026-10-16T00:00:00Z") + w * 7 * 86_400_000).toISOString().slice(0, 10));
    expect(fridays.slice(0, 8).map(divisionFor)).toEqual([...DIVISIONS]);
    expect(divisionFor(fridays[8])).toBe(DIVISIONS[0]);
  });
  it("picks the season by month", () => {
    expect(seasonFor("2026-10-31")).toBe("halloween");
    expect(seasonFor("2026-11-01")).toBe("fall");
    expect(seasonFor("2026-12-25")).toBe("christmas");
    expect(seasonFor("2027-01-05")).toBeNull();
  });
});

describe("themed daily set validation", () => {
  it("requires one league on NFL Monday / College Tuesday", () => {
    const mixed = tiers.map((d, i) => mk(i, d, i % 2 ? "NFL" : "FBS"));
    expect(validateDailySet("2026-10-19", mixed, bank).join(" ")).toMatch(/NFL only/);
    expect(validateDailySet("2026-10-20", mixed, bank).join(" ")).toMatch(/FBS only/);
    expect(validateDailySet("2026-10-19", tiers.map((d, i) => mk(i, d, "NFL")), bank)).toEqual([]);
  });
  it("requires the rotating division tag on Division Friday", () => {
    const div = divisionFor("2026-10-16");
    expect(validateDailySet("2026-10-16", tiers.map((d, i) => mk(i, d, "NFL")), bank).join(" ")).toMatch(/need the tag/);
    expect(validateDailySet("2026-10-16", tiers.map((d, i) => mk(i, d, "NFL", { tags: [div] })), bank)).toEqual([]);
  });
  it("keeps Throwback Thursday before the College Football Playoff era", () => {
    const ok = tiers.map((d, i) => mk(i, d, i % 2 ? "NFL" : "FBS", { explanation: "It happened in 2006." }));
    expect(validateDailySet("2026-10-15", ok, bank)).toEqual([]);
    const late = ok.map((q, i) => (i === 0 ? { ...q, explanation: "That was in 2019." } : i === 1 ? { ...q, question: q.question + " Super Bowl 52" } : q));
    const errs = validateDailySet("2026-10-15", late, bank).join(" ");
    expect(errs).toMatch(/2019/);
    expect(errs).toMatch(/Super Bowl 52/);
  });
});

describe("fallback schedule on themed days", () => {
  it("serves only NFL on NFL Monday and only FBS on College Tuesday", () => {
    expect(new Set(dailyQuestions(bank, "2026-10-19").map((x) => x.q.league))).toEqual(new Set(["NFL"]));
    expect(new Set(dailyQuestions(bank, "2026-10-20").map((x) => x.q.league))).toEqual(new Set(["FBS"]));
  });
});
