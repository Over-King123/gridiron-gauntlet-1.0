import { io, type Socket } from "socket.io-client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Ack, ClientToServer, RoomSnapshot, ServerToClient, SessionInfo } from "../shared/types.ts";

type GSocket = Socket<ServerToClient, ClientToServer>;

const SESSION_KEY = "gg-session";

function loadSession(): SessionInfo | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}
function saveSession(s: SessionInfo | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked: refresh-rejoin just won't work */
  }
}

export interface Store {
  connected: boolean;
  /** true while we try to resume a saved session at startup */
  resuming: boolean;
  room: RoomSnapshot | null;
  /** Date.now() + offset ≈ server time */
  clockOffset: number;
  notice: string | null;
}

let state: Store = { connected: false, resuming: !!loadSession(), room: null, clockOffset: 0, notice: null };
const listeners = new Set<() => void>();
function set(patch: Partial<Store>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const socket: GSocket = io({ transports: ["websocket", "polling"], reconnectionDelayMax: 3000 });

socket.on("connect", () => {
  set({ connected: true });
  const s = loadSession();
  if (s) {
    socket.emit("resume", s, (r) => {
      if (!r.ok) {
        saveSession(null);
        set({ room: null, notice: state.room ? r.error ?? "Couldn't rejoin" : null });
      }
      set({ resuming: false });
    });
  } else set({ resuming: false });
});
socket.on("disconnect", () => set({ connected: false }));
socket.on("state", (room) => {
  // smooth the offset a little so one slow packet doesn't jolt the countdown
  const sample = room.serverNow - Date.now();
  const offset = state.room ? state.clockOffset * 0.7 + sample * 0.3 : sample;
  set({ room, clockOffset: offset, resuming: false });
});
socket.on("kicked", () => {
  saveSession(null);
  set({ room: null, notice: "The host removed you from the room." });
});

function call<T = unknown>(event: keyof ClientToServer, payload: object): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error("Not connected. Check your signal and try again."));
    const timer = setTimeout(() => reject(new Error("Server didn't respond. Try again.")), 8000);
    (socket.emit as any)(event, payload, (r: Ack<T>) => {
      clearTimeout(timer);
      r.ok ? resolve(r.data as T) : reject(new Error(r.error ?? "Something went wrong"));
    });
  });
}

export const actions = {
  async create(name: string) {
    const s = await call<SessionInfo>("createRoom", { name });
    saveSession(s);
  },
  async join(code: string, name: string) {
    const s = await call<SessionInfo>("joinRoom", { code, name });
    saveSession(s);
  },
  setLeague: (league: string) => call("setLeague", { league }),
  start: () => call("startGame", {}),
  answer: (questionId: string, choice: number) => call("submitAnswer", { questionId, choice }),
  playAgain: () => call("playAgain", {}),
  kick: (playerId: string) => call("kick", { playerId }),
  async leave() {
    try {
      await call("leaveRoom", {});
    } catch {
      /* leaving anyway */
    }
    saveSession(null);
    set({ room: null });
  },
  clearNotice: () => set({ notice: null }),
};

export function useStore(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Milliseconds left until a server timestamp, re-rendering ~10x/s. */
export function useCountdown(endsAt: number | null, offset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return 0;
  return Math.max(0, endsAt - (now + offset));
}
