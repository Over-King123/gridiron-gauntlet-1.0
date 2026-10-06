import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import type { Ack, ClientToServer, LeagueMode, ServerToClient, SessionInfo } from "../shared/types.ts";
import { loadQuestionBank } from "./questions.ts";
import { GameError, Room } from "./room.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 3000);

const bank = loadQuestionBank(path.join(ROOT, "content", "questions"));
const counts = bank.reduce<Record<string, number>>((m, q) => {
  const k = `${q.league}-d${q.difficulty}`;
  m[k] = (m[k] ?? 0) + 1;
  return m;
}, {});
console.log(`Loaded ${bank.length} questions`, counts);

const app = express();
const server = http.createServer(app);

interface SocketData {
  code?: string;
  playerId?: string;
}
type GSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(server, {
  pingInterval: 10_000,
  pingTimeout: 8_000,
  cors: process.env.NODE_ENV === "production" ? undefined : { origin: "*" },
});

const rooms = new Map<string, Room>();
/** number of live sockets per player, so a second tab doesn't flip someone offline */
const socketCount = new Map<string, number>();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O
function newCode(): string {
  for (let i = 0; i < 1000; i++) {
    let c = "";
    for (let j = 0; j < 4; j++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new GameError("Server is busy, try again");
}

function broadcast(room: Room) {
  const sockets = io.sockets.adapter.rooms.get(room.code);
  if (!sockets) return;
  for (const id of sockets) {
    const s = io.sockets.sockets.get(id) as GSocket | undefined;
    if (s?.data.playerId) s.emit("state", room.snapshotFor(s.data.playerId));
  }
}

function attach(socket: GSocket, room: Room, playerId: string) {
  detach(socket);
  socket.data.code = room.code;
  socket.data.playerId = playerId;
  socket.join(room.code);
  socketCount.set(playerId, (socketCount.get(playerId) ?? 0) + 1);
  room.setConnected(playerId, true);
  socket.emit("state", room.snapshotFor(playerId));
}

function detach(socket: GSocket) {
  const { code, playerId } = socket.data;
  if (!code || !playerId) return;
  socket.leave(code);
  socket.data.code = undefined;
  socket.data.playerId = undefined;
  const n = (socketCount.get(playerId) ?? 1) - 1;
  if (n <= 0) {
    socketCount.delete(playerId);
    rooms.get(code)?.setConnected(playerId, false);
  } else socketCount.set(playerId, n);
}

/** Wrap a handler: catch GameErrors into acks, guard against missing acks / bad payloads. */
function handle<P>(fn: (p: P) => unknown) {
  return (p: P, ack?: (r: Ack<any>) => void) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const data = fn((p ?? {}) as P);
      reply({ ok: true, data });
    } catch (e) {
      if (e instanceof GameError) reply({ ok: false, error: e.message });
      else {
        console.error(e);
        reply({ ok: false, error: "Something went wrong" });
      }
    }
  };
}

io.on("connection", (socket: GSocket) => {
  // crude flood guard: 30 events per 5s per socket
  let events = 0;
  const resetter = setInterval(() => (events = 0), 5000);
  socket.use((_packet, next) => (++events > 30 ? next(new Error("rate limited")) : next()));

  const roomOf = () => {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    if (!room || !socket.data.playerId) throw new GameError("You're not in a room");
    return { room, playerId: socket.data.playerId };
  };

  socket.on(
    "createRoom",
    handle<{ name: string }>(({ name }) => {
      if (rooms.size > 5000) throw new GameError("Server is full, try again later");
      const code = newCode();
      const room = new Room(code, bank, broadcast);
      const p = room.addPlayer(name);
      rooms.set(code, room);
      attach(socket, room, p.id);
      return { code, playerId: p.id, token: p.token } satisfies SessionInfo;
    }),
  );

  socket.on(
    "joinRoom",
    handle<{ code: string; name: string }>(({ code, name }) => {
      const room = rooms.get(String(code ?? "").trim().toUpperCase());
      if (!room) throw new GameError("No room with that code");
      const p = room.addPlayer(name);
      attach(socket, room, p.id);
      return { code: room.code, playerId: p.id, token: p.token } satisfies SessionInfo;
    }),
  );

  socket.on(
    "resume",
    handle<SessionInfo>(({ code, playerId, token }) => {
      const room = rooms.get(String(code ?? "").toUpperCase());
      if (!room) throw new GameError("That game has ended");
      const p = room.resume(String(playerId), String(token));
      if (!p) throw new GameError("Couldn't rejoin that game");
      attach(socket, room, p.id);
      return { code: room.code, playerId: p.id, token: p.token } satisfies SessionInfo;
    }),
  );

  socket.on(
    "setLeague",
    handle<{ league: LeagueMode }>(({ league }) => {
      const { room, playerId } = roomOf();
      room.setLeague(playerId, league);
    }),
  );

  socket.on(
    "startGame",
    handle(() => {
      const { room, playerId } = roomOf();
      room.startGame(playerId);
    }),
  );

  socket.on(
    "submitAnswer",
    handle<{ questionId: string; choice: number }>(({ questionId, choice }) => {
      const { room, playerId } = roomOf();
      room.submitAnswer(playerId, String(questionId), Number(choice));
    }),
  );

  socket.on(
    "playAgain",
    handle(() => {
      const { room, playerId } = roomOf();
      room.playAgain(playerId);
    }),
  );

  socket.on(
    "kick",
    handle<{ playerId: string }>(({ playerId: target }) => {
      const { room, playerId } = roomOf();
      room.kick(playerId, String(target));
      for (const s of io.sockets.sockets.values() as Iterable<GSocket>) {
        if (s.data.playerId === target) {
          s.emit("kicked");
          s.leave(room.code);
          s.data.code = undefined;
          s.data.playerId = undefined;
        }
      }
      socketCount.delete(String(target));
    }),
  );

  socket.on(
    "leaveRoom",
    handle(() => {
      const { room, playerId } = roomOf();
      const others = [...io.sockets.sockets.values()].filter(
        (s) => s.id !== socket.id && (s as GSocket).data.playerId === playerId,
      ) as GSocket[];
      for (const s of [socket, ...others]) {
        s.leave(room.code);
        s.data.code = undefined;
        s.data.playerId = undefined;
      }
      socketCount.delete(playerId);
      room.removePlayer(playerId);
      if (room.players.size === 0) {
        room.destroy();
        rooms.delete(room.code);
      }
    }),
  );

  socket.on("disconnect", () => {
    clearInterval(resetter);
    detach(socket);
  });
});

// Cleanup: empty rooms after 15 min, any room idle 2 h.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const idle = now - room.lastActivity;
    if ((room.connectedCount() === 0 && idle > 15 * 60_000) || idle > 2 * 60 * 60_000) {
      room.destroy();
      rooms.delete(code);
    }
  }
}, 60_000).unref();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, questions: bank.length });
});

const clientDir = path.join(ROOT, "dist", "client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
}

server.listen(PORT, () => console.log(`Gridiron Gauntlet listening on :${PORT}`));
