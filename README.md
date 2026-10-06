# Gridiron Gauntlet

Real-time multiplayer football trivia for 2–8 players. Players join from their own phones with a 4-letter room code; no accounts.

## How it works

- **Server-authoritative.** One Node.js service (Express + Socket.IO) owns every room: players, host, timer, answers, scoring and round progression. Clients only send intents (`createRoom`, `joinRoom`, `submitAnswer`, …) and render the snapshot the server pushes.
- **Timer and answers** are judged by server receipt time. The correct answer never reaches a client until the reveal.
- **Reconnection.** Each player gets a secret token in `sessionStorage`; a refresh or dropped connection rejoins the same seat. Disconnected players don't hold up the game, and host status moves on after 10 seconds.
- **Rooms live in memory** and are cleaned up when idle.

## Daily Gauntlet (single player)

- Same 10 questions for everyone each day, NFL and FBS mixed, ordered 3 / 4 / 3 by difficulty. No category labels, no timer.
- Each day's 10 questions are locked in storage the first time that day is opened, so a mid-day deploy never changes them.
- Day boundary is midnight `America/Chicago`; Daily #1 is 2026-10-06 (`server/daily.ts`, `DAILY_CONFIG`).
- **Fresh questions every day:** a nightly scheduled task writes 10 new, fact-checked questions to `content/daily/<date>.json` (rules in `NIGHTLY.md`). When a dated set exists it's used for that day; past sets join the multiplayer pool.
- At most one "classic" (pre-1990, tagged `classic`) question per daily, two per multiplayer game.
- If a day has no dated set, questions follow a fixed shuffled schedule per difficulty tier, so nothing repeats until a tier is used up (about 17 days with the current deep-cut pool; add questions to extend it).
- One attempt per device per day. Score is X/10; ties go to the faster total time, measured on the server.
- Daily board shows everyone who posted a name, and starts empty each day.
- Themed days: add a date and tag to `DAILY_THEMES` in `server/daily.ts` and tag questions (e.g. `"tags": ["SEC"]`).
- Storage: Upstash Redis via `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them the server keeps the board in memory (dev only). `/healthz` reports which store is active.

## Scoring (multiplayer)

- Correct: `700 + round(300 × timeRemaining / 20s)` → 700–1,000 points
- Wrong or no answer: 0
- Final question (Q15): ×3
- Ties: lower total time on correct answers wins

All constants live in `server/config.ts`.

## Questions

Question data lives in `content/questions/*.json`, separate from the engine. Every file is an array of:

```json
{
  "id": "nfl-001",
  "league": "NFL",
  "category": "iconic games",
  "difficulty": 1,
  "question": "...",
  "answers": ["correct or not", "...", "...", "..."],
  "correctIndex": 0,
  "explanation": "...",
  "source": "optional"
}
```

Difficulty: 1 = knowledgeable fan, 2 = serious fan, 3 = deep cut. Answer order is shuffled by the server each game, so `correctIndex` can always be 0. Each game draws 6/6/2 from tiers 1/2/3 plus a tier-3 final, and avoids repeats within a room.

Drop new JSON files in the folder to add packs. `npm run validate` checks them; the server also refuses to start on an invalid question.

## Commands

```bash
npm install
npm run dev        # server on :3000 + Vite dev server on :5173
npm test           # engine unit tests
npm run validate   # check the question bank
npm run build && npm start   # production
npx tsx scripts/simulate.ts http://localhost:3000 5   # 5 bot players play a full game
```

## Layout

```
server/        index.ts (sockets/http), room.ts (game engine), questions.ts, config.ts
shared/        types shared by server and client
client/        React UI
content/       question bank (JSON)
scripts/       validator and multiplayer simulator
```

## Deploy

`render.yaml` defines a single Render web service. Connect the GitHub repo in Render as a Blueprint, or create a Web Service with build `npm install --include=dev && npm run build` and start `npm start`.
