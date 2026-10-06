// End-to-end smoke test: N bot players play a full game against a running server.
// Usage: tsx scripts/simulate.ts [url] [players]
import { io, type Socket } from "socket.io-client";
import type { Ack, RoomSnapshot, SessionInfo } from "../shared/types.ts";

const URL = process.argv[2] ?? "http://localhost:3000";
const N = Number(process.argv[3] ?? 4);

type Bot = { name: string; sock: Socket; session?: SessionInfo; last?: RoomSnapshot; questionsSeen: string[]; points: number };

function emit<T>(s: Socket, ev: string, p: object): Promise<Ack<T>> {
  return new Promise((r) => s.emit(ev, p, r));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (m: string) => {
  console.error("FAIL:", m);
  process.exit(1);
};

function connect(bot: Bot) {
  bot.sock = io(URL, { transports: ["websocket"], forceNew: true });
  bot.sock.on("state", (s: RoomSnapshot) => onState(bot, s));
}

const answered = new Set<string>();
function onState(bot: Bot, s: RoomSnapshot) {
  const prev = bot.last;
  bot.last = s;
  if (s.phase === "question" && s.question && !bot.questionsSeen.includes(s.question.id)) bot.questionsSeen.push(s.question.id);
  if (s.phase === "reveal" && prev?.phase !== "reveal" && s.reveal) bot.points += s.reveal.results[s.you]?.points ?? 0;
  if (s.phase === "question" && s.question && s.myChoice == null) {
    const key = `${bot.name}:${s.question.id}`;
    if (answered.has(key)) return;
    answered.add(key);
    // bot 2 sits out question 3 entirely to exercise the timeout path
    if (bot.name === "Bot2" && s.question.number === 3) return;
    setTimeout(async () => {
      const r = await emit(bot.sock, "submitAnswer", { questionId: s.question!.id, choice: Math.floor(Math.random() * 4) });
      if (!r.ok && !/closed|No question/.test(r.error ?? "")) console.warn(bot.name, "answer rejected:", r.error);
    }, 150 + Math.random() * 1500);
  }
}

async function main() {
  const t0 = Date.now();
  const bots: Bot[] = Array.from({ length: N }, (_, i) => ({ name: `Bot${i}`, questionsSeen: [], points: 0 }) as unknown as Bot);
  bots.forEach(connect);
  await sleep(500);

  const c = await emit<SessionInfo>(bots[0].sock, "createRoom", { name: bots[0].name });
  if (!c.ok) fail("create: " + c.error);
  bots[0].session = c.data;
  const code = c.data!.code;
  console.log("room", code);

  // bad joins
  const bad = await emit(bots[1].sock, "joinRoom", { code: "ZZZZ", name: "x" });
  if (bad.ok) fail("joined a nonexistent room");
  for (const b of bots.slice(1)) {
    const r = await emit<SessionInfo>(b.sock, "joinRoom", { code: code.toLowerCase(), name: b.name });
    if (!r.ok) fail("join: " + r.error);
    b.session = r.data;
  }
  const dup = await emit(io(URL, { transports: ["websocket"], forceNew: true }), "joinRoom", { code, name: "bot0" });
  if (dup.ok) fail("duplicate name accepted");

  const notHost = await emit(bots[1].sock, "startGame", {});
  if (notHost.ok) fail("non-host started the game");
  await emit(bots[0].sock, "setLeague", { league: "MIXED" });
  const st = await emit(bots[0].sock, "startGame", {});
  if (!st.ok) fail("start: " + st.error);

  // bot3 drops after Q4 and comes back two questions later via resume
  let dropped = false;
  while (bots[0].last?.phase !== "final") {
    await sleep(200);
    const q = bots[0].last?.question?.number ?? 0;
    if (N > 3 && !dropped && q === 5) {
      dropped = true;
      bots[3].sock.disconnect();
      console.log("Bot3 disconnected at Q5");
      setTimeout(async () => {
        connect(bots[3]);
        await sleep(300);
        const r = await emit(bots[3].sock, "resume", bots[3].session!);
        console.log("Bot3 resume:", r.ok ? "ok" : r.error);
        if (!r.ok) fail("resume failed");
      }, 12_000);
    }
    if (Date.now() - t0 > 8 * 60_000) fail("game took too long");
  }
  await sleep(500);

  const final = bots[0].last!;
  console.log("final standings:");
  for (const p of final.players) console.log(`  ${p.name.padEnd(6)} ${String(p.score).padStart(6)}  ${p.connected ? "" : "(away)"}`);

  // every bot that stayed connected saw the same 15 questions in the same order
  const ref = bots[0].questionsSeen;
  if (ref.length !== 15) fail(`host saw ${ref.length} questions`);
  for (const b of bots) {
    if (b.name === "Bot3") continue;
    if (b.questionsSeen.join() !== ref.join()) fail(`${b.name} saw a different question sequence`);
    if (b.last?.phase !== "final") fail(`${b.name} not on final screen`);
  }
  // server scores equal the sum of per-question awarded points seen by each client
  for (const b of bots) {
    if (b.name === "Bot3") continue;
    const server = final.players.find((p) => p.name === b.name)!.score;
    if (server !== b.points) fail(`${b.name}: server ${server} vs summed ${b.points}`);
  }
  const final3 = final.players.find((p) => p.name === "Bot3");
  if (N > 3 && !final3?.connected) fail("Bot3 did not come back");

  // play again goes back to lobby with scores reset
  const pa = await emit(bots[0].sock, "playAgain", {});
  if (!pa.ok) fail("playAgain: " + pa.error);
  await sleep(300);
  if (bots[1].last?.phase !== "lobby" || bots[1].last.players.some((p) => p.score !== 0)) fail("play again didn't reset");

  console.log(`PASS in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
}
main();
