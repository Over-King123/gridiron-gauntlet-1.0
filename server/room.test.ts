import { describe, expect, it } from "vitest";
import type { Question } from "../shared/types.ts";
import { GAME_CONFIG, scoreAnswer } from "./config.ts";
import { Room, type Clock } from "./room.ts";
import { selectQuestions } from "./questions.ts";

class FakeClock implements Clock {
  t = 1_000_000;
  timers: { at: number; fn: () => void; id: number }[] = [];
  id = 0;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.id;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

function makeBank(): Question[] {
  const out: Question[] = [];
  for (const league of ["NFL", "FBS"] as const)
    for (let d = 1; d <= 3; d++)
      for (let i = 0; i < 12; i++)
        out.push({
          id: `${league}-${d}-${i}`,
          league,
          category: "test",
          difficulty: d as 1 | 2 | 3,
          question: `Question ${league} ${d} ${i}?`,
          answers: ["A", "B", "C", "D"],
          correctIndex: 0,
          explanation: "because",
        });
  return out;
}

function setup(n = 3) {
  const clock = new FakeClock();
  let seed = 42;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const room = new Room("TEST", makeBank(), () => {}, clock, rng);
  const players = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`));
  return { clock, room, players };
}

function correctChoice(room: Room) {
  // engine-internal: correct answer text is "A"
  const snap = room.snapshotFor("x");
  return snap.question!.answers.indexOf("A");
}

describe("scoring", () => {
  it("rewards accuracy over speed", () => {
    const D = 20_000;
    expect(scoreAnswer(true, 0, D, 1)).toBe(1000);
    expect(scoreAnswer(true, D, D, 1)).toBe(700);
    expect(scoreAnswer(true, 10_000, D, 1)).toBe(850);
    expect(scoreAnswer(false, 0, D, 1)).toBe(0);
    expect(scoreAnswer(true, 25_000, D, 1)).toBe(700); // late grace never goes below base
    expect(scoreAnswer(true, 0, D, 3)).toBe(3000);
  });
});

describe("question selection", () => {
  it("picks 15 unique questions with a hard final", () => {
    const qs = selectQuestions(makeBank(), "NFL", new Set(), Math.random);
    expect(qs).toHaveLength(15);
    expect(new Set(qs.map((q) => q.id)).size).toBe(15);
    expect(qs.every((q) => q.league === "NFL")).toBe(true);
    expect(qs[14].difficulty).toBe(3);
    const d = [0, 0, 0];
    qs.slice(0, 14).forEach((q) => d[q.difficulty - 1]++);
    expect(d).toEqual([9, 4, 1]);
  });
  it("balances MIXED and avoids used questions", () => {
    const bank = makeBank();
    const used = new Set(bank.filter((q) => q.difficulty === 1).slice(0, 6).map((q) => q.id));
    const qs = selectQuestions(bank, "MIXED", used, Math.random);
    const nfl = qs.filter((q) => q.league === "NFL").length;
    expect(nfl).toBeGreaterThanOrEqual(6);
    expect(nfl).toBeLessThanOrEqual(9);
    expect(qs.some((q) => used.has(q.id))).toBe(false);
  });
});

describe("room flow", () => {
  it("only the host can start, needs 2 players", () => {
    const { room, players } = setup(1);
    expect(() => room.startGame(players[0].id)).toThrow(/at least 2/);
    const p2 = room.addPlayer("Two");
    expect(() => room.startGame(p2.id)).toThrow(/host/);
    room.startGame(players[0].id);
    expect(room.phase).toBe("question");
  });

  it("rejects duplicate names and caps players at 8", () => {
    const { room } = setup(1);
    expect(() => room.addPlayer("p0")).toThrow(/taken/);
    for (let i = 1; i < 8; i++) room.addPlayer(`X${i}`);
    expect(() => room.addPlayer("Ninth")).toThrow(/full/);
  });

  it("never exposes the correct answer before reveal", () => {
    const { room, players } = setup(2);
    room.startGame(players[0].id);
    const snap = room.snapshotFor(players[0].id);
    expect(snap.reveal).toBeNull();
    expect(JSON.stringify(snap)).not.toContain("correctIndex");
  });

  it("scores server-side by receipt time, locks answers, reveals early when all answered", () => {
    const { clock, room, players } = setup(2);
    room.startGame(players[0].id);
    const qid = room.snapshotFor(players[0].id).question!.id;
    const c = correctChoice(room);
    clock.advance(5000);
    room.submitAnswer(players[0].id, qid, c);
    expect(() => room.submitAnswer(players[0].id, qid, (c + 1) % 4)).toThrow(/locked/);
    expect(room.phase).toBe("question");
    clock.advance(5000);
    room.submitAnswer(players[1].id, qid, (c + 1) % 4);
    expect(room.phase).toBe("reveal");
    expect(room.players.get(players[0].id)!.score).toBe(925); // 700 + 300*15/20
    expect(room.players.get(players[1].id)!.score).toBe(0);
  });

  it("rejects answers after the deadline + grace, accepts inside grace", () => {
    const { clock, room, players } = setup(3);
    room.startGame(players[0].id);
    const qid = room.snapshotFor(players[0].id).question!.id;
    const c = correctChoice(room);
    clock.advance(GAME_CONFIG.questionDurationMs + 100);
    room.submitAnswer(players[0].id, qid, c); // inside grace
    expect(room.players.get(players[0].id)!.score).toBe(0); // not yet revealed
    clock.advance(GAME_CONFIG.lateGraceMs); // timer fires -> reveal
    expect(room.phase).toBe("reveal");
    expect(room.players.get(players[0].id)!.score).toBe(700);
    expect(() => room.submitAnswer(players[1].id, qid, c)).toThrow();
  });

  it("disconnected players don't block the early reveal", () => {
    const { room, players } = setup(3);
    room.startGame(players[0].id);
    const qid = room.snapshotFor(players[0].id).question!.id;
    room.setConnected(players[2].id, false);
    room.submitAnswer(players[0].id, qid, 0);
    room.submitAnswer(players[1].id, qid, 0);
    expect(room.phase).toBe("reveal");
  });

  it("runs a full 15-question game with a 3x final", () => {
    const { clock, room, players } = setup(2);
    room.startGame(players[0].id);
    let finals = 0;
    for (let i = 0; i < 15; i++) {
      expect(room.phase).toBe("question");
      const snap = room.snapshotFor(players[0].id);
      expect(snap.question!.number).toBe(i + 1);
      if (snap.question!.isFinal) finals++;
      room.submitAnswer(players[0].id, snap.question!.id, correctChoice(room));
      room.submitAnswer(players[1].id, snap.question!.id, (correctChoice(room) + 1) % 4);
      expect(room.phase).toBe("reveal");
      clock.advance(GAME_CONFIG.revealDurationMs);
      if (i < 14) {
        expect(room.phase).toBe("leaderboard");
        clock.advance(GAME_CONFIG.leaderboardDurationMs);
      }
    }
    expect(finals).toBe(1);
    expect(room.phase).toBe("final");
    // 14 instant correct answers at 1000 + final at 3000
    expect(room.players.get(players[0].id)!.score).toBe(17000);
    expect(room.ranking()[0].id).toBe(players[0].id);

    room.playAgain(players[0].id);
    expect(room.phase).toBe("lobby");
    room.startGame(players[0].id);
    expect(room.players.get(players[0].id)!.score).toBe(0);
  });

  it("times out a question with nobody answering", () => {
    const { clock, room, players } = setup(2);
    room.startGame(players[0].id);
    clock.advance(GAME_CONFIG.questionDurationMs + GAME_CONFIG.lateGraceMs);
    expect(room.phase).toBe("reveal");
    expect(room.ranking().every((p) => p.score === 0)).toBe(true);
  });

  it("hands host to the next player after the grace period, and keeps it on quick refresh", () => {
    const { clock, room, players } = setup(3);
    room.setConnected(players[0].id, false);
    clock.advance(5000);
    room.resume(players[0].id, players[0].token);
    clock.advance(20_000);
    expect(room.hostId).toBe(players[0].id);
    room.setConnected(players[0].id, false);
    clock.advance(GAME_CONFIG.hostGraceMs + 1);
    expect(room.hostId).toBe(players[1].id);
  });

  it("resume requires the right token and restores the locked choice", () => {
    const { room, players } = setup(2);
    room.startGame(players[0].id);
    const qid = room.snapshotFor(players[0].id).question!.id;
    room.submitAnswer(players[0].id, qid, 2);
    room.setConnected(players[0].id, false);
    expect(room.resume(players[0].id, "wrong")).toBeNull();
    expect(room.resume(players[0].id, players[0].token)).not.toBeNull();
    expect(room.snapshotFor(players[0].id).myChoice).toBe(2);
  });
});
