import { useCallback, useEffect, useState } from "react";


const LETTERS = ["A", "B", "C", "D"];

interface HistoryItem {
  question: string;
  answers: string[];
  choice: number;
  correctIndex: number;
  correct: boolean;
  explanation: string;
}
interface DailyState {
  date: string;
  number: number;
  total: number;
  theme: string | null;
  resetInMs: number;
  attemptId: string;
  history: HistoryItem[];
  current: { index: number; question: string; answers: string[] } | null;
  finished: boolean;
  score: number;
  timeMs: number | null;
  submittedName: string | null;
}
interface Board {
  date: string;
  number: number;
  resetInMs: number;
  plays: number;
  total: number;
  myRank: number | null;
  entries: { rank: number; name: string; score: number; timeMs: number; marks: string; me: boolean }[];
}

// ---------- api ----------

async function api<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error("Can't reach the server. Check your connection.");
  });
  const json = await res.json().catch(() => ({ ok: false, error: "The server is waking up. Try again in a moment." }));
  if (!json.ok) throw new Error(json.error ?? "Something went wrong");
  return json.data as T;
}

function store<T>(key: string, value?: T | null): T | null {
  try {
    if (value === undefined) {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  return null;
}

function deviceId(): string {
  let id = store<string>("gg-device");
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    store("gg-device", id);
  }
  return id;
}

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const fmtReset = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

// ---------- component ----------

export function DailyApp({ onExit, logo }: { onExit: () => void; logo: React.ReactNode }) {
  const [state, setState] = useState<DailyState | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const remember = (s: DailyState) => {
    setState(s);
    store("gg-daily", { date: s.date, attemptId: s.attemptId });
  };

  const loadBoard = useCallback(async (attemptId?: string) => {
    try {
      setBoard(await api<Board>(`/daily/leaderboard${attemptId ? `?attemptId=${encodeURIComponent(attemptId)}` : ""}`));
    } catch {}
  }, []);

  // on open: resume today's attempt if this device has one, else show the intro
  useEffect(() => {
    (async () => {
      const saved = store<{ date: string; attemptId: string }>("gg-daily");
      try {
        const b = await api<Board>("/daily/leaderboard");
        setBoard(b);
        if (saved && saved.date === b.date) {
          const s = await api<DailyState>("/daily/state", saved);
          setState(s);
          if (s.finished) loadBoard(s.attemptId);
        }
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBoard]);

  // live scoreboard refresh once finished
  useEffect(() => {
    if (!state?.finished) return;
    const id = setInterval(() => loadBoard(state.attemptId), 15_000);
    return () => clearInterval(id);
  }, [state?.finished, state?.attemptId, loadBoard]);

  const begin = async () => {
    setErr("");
    setLoading(true);
    try {
      const s = await api<DailyState>("/daily/start", { deviceId: deviceId() });
      remember(s);
      if (s.finished) loadBoard(s.attemptId);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  let body: React.ReactNode;
  if (loading && !state && !board) body = <p className="muted pulse center-text">Loading today's Gauntlet…</p>;
  else if (!state) body = <Intro board={board} onStart={begin} busy={loading} />;
  else if (!state.finished) body = <Play key={state.attemptId} state={state} onState={remember} />;
  else body = <Finished state={state} board={board} onState={remember} reloadBoard={() => loadBoard(state.attemptId)} />;

  return (
    <main className="screen">
      <header className="topbar">
        {logo}
        <button className="btn link" onClick={onExit}>
          Home
        </button>
      </header>
      {err && <p className="error">{err}</p>}
      {body}
    </main>
  );
}

function Intro({ board, onStart, busy }: { board: Board | null; onStart: () => void; busy: boolean }) {
  return (
    <section className="daily-intro">
      <span className="label">Daily Gauntlet</span>
      <h1 className="daily-num">#{board?.number ?? "–"}</h1>
      <ul className="rules">
        <li>10 questions, NFL and college mixed</li>
        <li>Gets harder as you go</li>
        <li>No timer, but total time breaks ties</li>
        <li>One shot per day. Board resets at midnight Central</li>
      </ul>
      {board && board.plays > 0 && <p className="muted">{board.plays} played today</p>}
      <button className="btn primary big" onClick={onStart} disabled={busy}>
        {busy ? "…" : "Start today's 10"}
      </button>
    </section>
  );
}

function Progress({ state, pendingIndex }: { state: DailyState; pendingIndex: number }) {
  return (
    <div className="dots" aria-label={`Question ${pendingIndex + 1} of ${state.total}`}>
      {Array.from({ length: state.total }, (_, i) => {
        const h = state.history[i];
        const cls = h ? (h.correct ? "dot good" : "dot bad") : i === pendingIndex ? "dot now" : "dot";
        return <span key={i} className={cls} />;
      })}
    </div>
  );
}

function Play({ state, onState }: { state: DailyState; onState: (s: DailyState) => void }) {
  // After an answer we keep showing that question with feedback until "Next" is tapped.
  const [answered, setAnswered] = useState<{ index: number; item: HistoryItem; next: DailyState } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const index = answered ? answered.index : state.current?.index ?? 0;
  const q = answered ? answered.item : state.current;
  if (!q) return null;
  const shown = answered ? answered.next : state;
  const isLast = index === state.total - 1;

  const pick = async (i: number) => {
    if (busy !== null || answered || !state.current) return;
    setBusy(i);
    setErr("");
    navigator.vibrate?.(15);
    try {
      const s = await api<DailyState>("/daily/answer", {
        date: state.date,
        attemptId: state.attemptId,
        index: state.current.index,
        choice: i,
      });
      setAnswered({ index: state.current.index, item: s.history[state.current.index], next: s });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const advance = () => {
    if (!answered) return;
    const next = answered.next;
    setAnswered(null);
    onState(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fb = answered?.item;
  return (
    <section className="play daily-play">
      <div className="row between">
        <span className="qnum">
          {index + 1}
          <span className="muted">/{state.total}</span>
        </span>
        <Progress state={shown} pendingIndex={index} />
      </div>
      <h1 className="question">{q.question}</h1>
      <div className="answers">
        {q.answers.map((a, i) => {
          let cls = "answer";
          if (fb) {
            if (i === fb.correctIndex) cls += " correct";
            else if (i === fb.choice) cls += " wrong";
            else cls += " faded";
          } else if (busy !== null) cls += i === busy ? " picked" : " faded";
          return (
            <button key={i} className={cls} onClick={() => pick(i)} disabled={!!fb || busy !== null}>
              <span className="letter">{LETTERS[i]}</span>
              <span className="atext">{a}</span>
            </button>
          );
        })}
      </div>
      {err && <p className="error">{err}</p>}
      {fb && (
        <>
          <div className={`result ${fb.correct ? "good" : "bad"}`}>
            <div className="result-head">
              <span>{fb.correct ? "Correct" : "Wrong"}</span>
              <span className="pts">{shown.score} right</span>
            </div>
            <p className="explain">{fb.explanation}</p>
          </div>
          <button className="btn primary big" onClick={advance}>
            {isLast ? "See your score" : "Next question"}
          </button>
        </>
      )}
    </section>
  );
}

function Finished({
  state,
  board,
  onState,
  reloadBoard,
}: {
  state: DailyState;
  board: Board | null;
  onState: (s: DailyState) => void;
  reloadBoard: () => void;
}) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("gg-name") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [review, setReview] = useState(false);

  const squares = state.history.map((h) => (h.correct ? "🟩" : "🟥")).join("");
  const shareText = `Gridiron Gauntlet #${state.number}: ${state.score}/${state.total}\n${squares}\n${location.origin}/daily`;

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {}
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!name.trim()) return setErr("Enter a name for the board");
    setBusy(true);
    try {
      try {
        localStorage.setItem("gg-name", name.trim());
      } catch {}
      onState(await api<DailyState>("/daily/name", { date: state.date, attemptId: state.attemptId, name }));
      reloadBoard();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="daily-score">
        <span className="label">Daily Gauntlet #{state.number}</span>
        <h1>
          {state.score}
          <span className="muted">/{state.total}</span>
        </h1>
        <p className="squares">{squares}</p>
        {state.timeMs != null && <p className="muted">Finished in {fmtTime(state.timeMs)}</p>}
        <button className="btn ghost small" onClick={share}>
          {copied ? "Copied" : "Share result"}
        </button>
      </section>

      {!state.submittedName ? (
        <form className="card stack" onSubmit={submit}>
          <h3>Put your name on today's board</h3>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            placeholder="Your name"
            maxLength={16}
          />
          {err && <p className="error">{err}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? "…" : "Post my score"}
          </button>
        </form>
      ) : null}

      <section className="card">
        <div className="row between">
          <h3>Today's board</h3>
          {board && <span className="muted small-text no-margin">Resets in {fmtReset(board.resetInMs)}</span>}
        </div>
        {!board || board.entries.length === 0 ? (
          <p className="muted center-text">No one's posted yet. Be the first.</p>
        ) : (
          <ol className="board">
            {board.entries.map((e) => (
              <li key={e.rank} className={e.me ? "me" : ""}>
                <span className="rank">{e.rank}</span>
                <span className="pname">{e.name}</span>
                <span className="btime muted">{fmtTime(e.timeMs)}</span>
                <span className="score">
                  {e.score}
                  <span className="muted">/10</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {board && board.total > board.entries.length && (
          <p className="muted small-text">
            Showing top {board.entries.length} of {board.total}
            {board.myRank ? `. You're #${board.myRank}.` : ""}
          </p>
        )}
      </section>

      <button className="btn link" onClick={() => setReview(!review)}>
        {review ? "Hide answers" : "Review today's answers"}
      </button>
      {review && (
        <ol className="review">
          {state.history.map((h, i) => (
            <li key={i} className={h.correct ? "good" : "bad"}>
              <p className="rq">{h.question}</p>
              {h.correct ? (
                <p className="ra">✓ {h.answers[h.correctIndex]}</p>
              ) : (
                <p className="ra">
                  ✗ You said {h.answers[h.choice]}
                  <span className="right-ans"> · Answer: {h.answers[h.correctIndex]}</span>
                </p>
              )}
              <p className="explain small-text">{h.explanation}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
