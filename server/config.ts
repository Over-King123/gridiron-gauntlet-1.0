// All tunable game constants live here so modes/packs can override later.
export const GAME_CONFIG = {
  questionsPerGame: 15,
  questionDurationMs: 20_000,
  revealDurationMs: 5_000,
  leaderboardDurationMs: 4_500,
  /** network grace after the deadline; answers stamped by the server inside this window still count */
  lateGraceMs: 300,
  maxPlayers: 8,
  minPlayersToStart: 2,
  basePoints: 700,
  speedBonusPoints: 300,
  finalMultiplier: 3,
  /** how long a disconnected host keeps host status before it moves */
  hostGraceMs: 10_000,
  /** difficulty mix for the 14 regular questions: [d1, d2, d3] */
  regularMix: [6, 6, 2] as [number, number, number],
  nameMaxLength: 16,
};

export type GameConfig = typeof GAME_CONFIG;

/** Deterministic scoring. Same inputs -> same points for every player. */
export function scoreAnswer(
  correct: boolean,
  elapsedMs: number,
  durationMs: number,
  multiplier: number,
  cfg: Pick<GameConfig, "basePoints" | "speedBonusPoints"> = GAME_CONFIG,
): number {
  if (!correct) return 0;
  const remaining = Math.min(durationMs, Math.max(0, durationMs - elapsedMs));
  const speed = Math.round((cfg.speedBonusPoints * remaining) / durationMs);
  return (cfg.basePoints + speed) * multiplier;
}
