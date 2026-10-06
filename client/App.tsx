import { useEffect, useMemo, useRef, useState } from "react";
import type { LeagueMode, PublicPlayer, RoomSnapshot } from "../shared/types.ts";
import { actions, useCountdown, useStore } from "./game.ts";
import { DailyApp } from "./Daily.tsx";

const LEAGUE_LABEL: Record<LeagueMode, string> = { NFL: "NFL", FBS: "College (FBS)", MIXED: "Mixed" };
const LETTERS = ["A", "B", "C", "D"];

export function App() {
  const { room, connected, resuming, notice } = useStore();
  const [daily, setDaily] = useState(() => /^\/daily\/?$/i.test(location.pathname));
  const openDaily = (on: boolean) => {
    setDaily(on);
    history.replaceState(null, "", on ? "/daily" : "/");
  };
  const initialCode = useMemo(() => {
    const m = location.pathname.match(/^\/([A-Za-z]{4})\/?$/) ?? location.search.match(/[?&]code=([A-Za-z]{4})/);
    return m ? m[1].toUpperCase() : "";
  }, []);

  let body: React.ReactNode;
  if (resuming) body = <Splash text="Rejoining your game…" />;
  else if (!room && daily) body = <DailyApp onExit={() => openDaily(false)} logo={<Logo small />} />;
  else if (!room) body = <Entry initialCode={initialCode} onDaily={() => openDaily(true)} />;
  else if (room.phase === "lobby") body = <Lobby room={room} />;
  else if (room.phase === "question" || room.phase === "reveal") body = <QuestionScreen room={room} />;
  else if (room.phase === "leaderboard") body = <Leaderboard room={room} />;
  else body = <Final room={room} />;

  return (
    <div className="app">
      {!connected && !resuming && <div className="conn">Reconnecting…</div>}
      {notice && (
        <div className="notice" onClick={actions.clearNotice}>
          {notice} <span className="x">✕</span>
        </div>
      )}
      {body}
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <main className="screen center">
      <Logo />
      <p className="muted pulse">{text}</p>
    </main>
  );
}

function Logo({ small }: { small?: boolean }) {
  return (
    <div className={small ? "logo small" : "logo"}>
      <span className="logo-top">Gridiron</span>
      <span className="logo-bottom">Gauntlet</span>
    </div>
  );
}

// ---------------- landing / create / join ----------------

function Entry({ initialCode, onDaily }: { initialCode: string; onDaily: () => void }) {
  const [mode, setMode] = useState<"home" | "create" | "join">(initialCode ? "join" : "home");
  const [name, setName] = useState(() => localStorage.getItem("gg-name") ?? "");
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!name.trim()) return setErr("Enter a display name");
    if (mode === "join" && code.trim().length !== 4) return setErr("Room codes are 4 letters");
    setBusy(true);
    try {
      try {
        localStorage.setItem("gg-name", name.trim());
      } catch {}
      if (mode === "create") await actions.create(name);
      else await actions.join(code, name);
      if (location.pathname !== "/") history.replaceState(null, "", "/");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (mode === "home")
    return (
      <main className="screen center">
        <Logo />
        <p className="tagline">NFL and college football trivia</p>
        <div className="stack wide">
          <button className="btn primary big daily-cta" onClick={onDaily}>
            <span>Daily Gauntlet</span>
            <small>10 questions · new every day</small>
          </button>
          <div className="divider">
            <span>Multiplayer</span>
          </div>
          <div className="pair">
            <button className="btn ghost" onClick={() => setMode("create")}>
              Create room
            </button>
            <button className="btn ghost" onClick={() => setMode("join")}>
              Join room
            </button>
          </div>
        </div>

      </main>
    );

  return (
    <main className="screen center">
      <Logo small />
      <form className="card stack wide" onSubmit={submit}>
        <h2>{mode === "create" ? "Create a game" : "Join a game"}</h2>
        {mode === "join" && (
          <label>
            Room code
            <input
              className="input code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4))}
              placeholder="ABCD"
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              autoFocus={!initialCode}
            />
          </label>
        )}
        <label>
          Your name
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            placeholder="Display name"
            maxLength={16}
            autoComplete="nickname"
            autoFocus={mode === "create" || !!initialCode}
          />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? "…" : mode === "create" ? "Create room" : "Join room"}
        </button>
        <button type="button" className="btn link" onClick={() => (setMode("home"), setErr(""))}>
          Back
        </button>
      </form>
    </main>
  );
}

// ---------------- lobby ----------------

function Lobby({ room }: { room: RoomSnapshot }) {
  const isHost = room.hostId === room.you;
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const online = room.players.filter((p) => p.connected).length;
  const link = `${location.origin}/${room.code}`;

  const run = (p: Promise<unknown>) => p.catch((e) => setErr(e.message));
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Gridiron Gauntlet", text: `Join my game: ${room.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {}
  };

  return (
    <main className="screen">
      <header className="topbar">
        <Logo small />
        <button className="btn link" onClick={actions.leave}>
          Leave
        </button>
      </header>

      <section className="code-block">
        <span className="label">Room code</span>
        <span className="room-code">{room.code}</span>
        <button className="btn ghost small" onClick={share}>
          {copied ? "Link copied" : "Copy invite link"}
        </button>
      </section>

      <section className="card">
        <div className="row between">
          <h3>Players</h3>
          <span className="muted">{room.players.length}/8</span>
        </div>
        <ul className="players">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? "" : "offline"}>
              <Avatar name={p.name} />
              <span className="pname">
                {p.name}
                {p.id === room.you && <em> (you)</em>}
              </span>
              {p.isHost && <span className="tag">Host</span>}
              {!p.connected && <span className="tag dim">Away</span>}
              {isHost && p.id !== room.you && (
                <button className="btn link tiny" onClick={() => run(actions.kick(p.id))} aria-label={`Remove ${p.name}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {room.players.length < 2 && <p className="muted center-text">At least 2 players needed</p>}
      </section>

      <section className="card">
        <h3>League</h3>
        <div className="segmented">
          {(["NFL", "FBS", "MIXED"] as LeagueMode[]).map((l) => (
            <button
              key={l}
              className={room.league === l ? "seg on" : "seg"}
              disabled={!isHost}
              onClick={() => run(actions.setLeague(l))}
            >
              {LEAGUE_LABEL[l]}
            </button>
          ))}
        </div>
        {!isHost && <p className="muted small-text">Selected by host</p>}
      </section>

      {err && <p className="error">{err}</p>}
      <div className="footer-action">
        {isHost ? (
          <button className="btn primary big" disabled={online < 2} onClick={() => run(actions.start())}>
            {online < 2 ? "Waiting for players" : `Start game · ${online} players`}
          </button>
        ) : (
          <p className="waiting">Waiting for host to start</p>
        )}
      </div>
    </main>
  );
}

function Avatar({ name }: { name: string }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="avatar" style={{ background: `hsl(${hue} 55% 40%)` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------------- question + reveal ----------------

function QuestionScreen({ room }: { room: RoomSnapshot }) {
  const { clockOffset } = useStore();
  const q = room.question!;
  const reveal = room.phase === "reveal" ? room.reveal : null;
  const msLeft = useCountdown(room.phase === "question" ? room.phaseEndsAt : null, clockOffset);
  const [pending, setPending] = useState<number | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setPending(null);
    setErr("");
  }, [q.id]);

  const locked = room.myChoice ?? pending;
  const answeredCount = room.players.filter((p) => p.answered).length;
  const online = room.players.filter((p) => p.connected).length;
  const mine = reveal?.results[room.you];

  const pick = (i: number) => {
    if (reveal || locked !== null || msLeft <= 0) return;
    setPending(i);
    navigator.vibrate?.(15);
    actions.answer(q.id, i).catch((e) => {
      setPending(null);
      setErr(e.message);
    });
  };

  const seconds = Math.ceil(msLeft / 1000);
  const frac = room.phase === "question" ? msLeft / room.questionDurationMs : 0;

  return (
    <main className={`screen play ${q.isFinal ? "final-q" : ""}`}>
      <header className="qbar">
        <span className="qnum">
          Q{q.number}
          <span className="muted">/{q.total}</span>
        </span>
        <span className="spacer" />
        <Clock frac={frac} seconds={seconds} done={!!reveal} />
      </header>

      {q.isFinal && <div className="final-banner">Final question · {q.multiplier}× points</div>}

      <h1 className="question">{q.question}</h1>

      <div className="answers">
        {q.answers.map((a, i) => {
          let cls = "answer";
          if (reveal) {
            if (i === reveal.correctIndex) cls += " correct";
            else if (i === locked) cls += " wrong";
            else cls += " faded";
          } else if (locked !== null) cls += i === locked ? " picked" : " faded";
          return (
            <button key={i} className={cls} onClick={() => pick(i)} disabled={!!reveal || locked !== null}>
              <span className="letter">{LETTERS[i]}</span>
              <span className="atext">{a}</span>
              {reveal && <span className="count">{reveal.answerCounts[i] || ""}</span>}
            </button>
          );
        })}
      </div>

      {err && <p className="error">{err}</p>}

      {!reveal ? (
        <p className="status-line">
          {locked !== null ? "Locked in. " : msLeft <= 0 ? "Time! " : ""}
          {answeredCount}/{online} answered
        </p>
      ) : (
        <div className={`result ${mine?.correct ? "good" : "bad"}`}>
          <div className="result-head">
            {mine?.correct ? (
              <>
                <span>Correct</span>
                <span className="pts">+{mine.points.toLocaleString()}</span>
              </>
            ) : mine?.choice == null ? (
              <span>No answer</span>
            ) : (
              <span>Incorrect</span>
            )}
          </div>
          <p className="explain">{reveal.explanation}</p>
        </div>
      )}
    </main>
  );
}

function Clock({ frac, seconds, done }: { frac: number; seconds: number; done: boolean }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const urgent = !done && seconds <= 5;
  return (
    <span className={`clock ${urgent ? "urgent" : ""}`}>
      <svg viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={r} className="track" />
        <circle
          cx="26"
          cy="26"
          r={r}
          className="fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, frac)))}
        />
      </svg>
      <span className="secs">{done ? "–" : seconds}</span>
    </span>
  );
}

// ---------------- leaderboard / final ----------------

function Standings({ room, highlightDeltas }: { room: RoomSnapshot; highlightDeltas: boolean }) {
  const prev = room.previousRanking;
  const results = room.reveal?.results ?? {};
  return (
    <ol className="standings">
      {room.players.map((p, i) => {
        const before = prev.indexOf(p.id);
        const move = before === -1 ? 0 : before - i;
        const gained = results[p.id]?.points ?? 0;
        return (
          <li key={p.id} className={`${p.id === room.you ? "me" : ""} ${p.connected ? "" : "offline"}`} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="rank">{i + 1}</span>
            <Avatar name={p.name} />
            <span className="pname">
              {p.name}
              {!p.connected && <em className="muted"> · away</em>}
            </span>
            {highlightDeltas && move !== 0 && <span className={move > 0 ? "move up" : "move down"}>{move > 0 ? `▲${move}` : `▼${-move}`}</span>}
            {highlightDeltas && gained > 0 && <span className="gain">+{gained}</span>}
            <AnimatedNumber value={p.score} />
          </li>
        );
      })}
    </ol>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="score">{shown.toLocaleString()}</span>;
}

function Leaderboard({ room }: { room: RoomSnapshot }) {
  const q = room.question!;
  const nextIsFinal = q.number === q.total - 1;
  return (
    <main className="screen">
      <header className="topbar">
        <h2 className="section-title">Leaderboard</h2>
        <span className="muted">
          {q.number}/{q.total} done
        </span>
      </header>
      <Standings room={room} highlightDeltas />
      <p className={nextIsFinal ? "up-next final" : "up-next"}>
        {nextIsFinal ? "Next: Final question · 3× points" : `Next: Question ${q.number + 1}`}
      </p>
    </main>
  );
}

function Final({ room }: { room: RoomSnapshot }) {
  const isHost = room.hostId === room.you;
  const [err, setErr] = useState("");
  const top = room.players[0];
  const tied = room.players.filter((p) => p.score === top?.score);
  const myRank = room.players.findIndex((p) => p.id === room.you) + 1;
  const winnerText =
    tied.length > 1 && top.score > 0 ? `${top.name} wins the tiebreak` : top ? `${top.name} wins` : "Game over";

  return (
    <main className="screen">
      <section className="winner">
        <span className="label">Final results</span>
        <h1>{winnerText}</h1>
        {top && <p className="big-score">{top.score.toLocaleString()} pts</p>}
        {myRank > 0 && room.players[0].id !== room.you && <p className="muted">You finished #{myRank}</p>}
      </section>
      <Podium players={room.players.slice(0, 3)} you={room.you} />
      <Standings room={room} highlightDeltas={false} />
      {err && <p className="error">{err}</p>}
      <div className="footer-action stack">
        {isHost ? (
          <button className="btn primary big" onClick={() => actions.playAgain().catch((e) => setErr(e.message))}>
            Play again
          </button>
        ) : (
          <p className="waiting">Waiting for host</p>
        )}
        <button className="btn link" onClick={actions.leave}>
          Leave room
        </button>
      </div>
    </main>
  );
}

function Podium({ players, you }: { players: PublicPlayer[]; you: string }) {
  if (players.length < 2) return null;
  const order = [players[1], players[0], players[2]].filter(Boolean);
  return (
    <div className="podium">
      {order.map((p) => {
        const place = players.indexOf(p) + 1;
        return (
          <div key={p.id} className={`step p${place} ${p.id === you ? "me" : ""}`}>
            <Avatar name={p.name} />
            <span className="pname">{p.name}</span>
            <div className="block">{place}</div>
          </div>
        );
      })}
    </div>
  );
}
