import { useEffect, useMemo } from "react";
import { SEASONS, chicagoDate, seasonFor, type Season } from "../shared/themes.ts";

/** Today's season, or a preview via ?season=halloween|fall|christmas|none */
export function currentSeason(): Season | null {
  const forced = new URLSearchParams(location.search).get("season");
  if (forced === "none") return null;
  if (forced && (SEASONS as string[]).includes(forced)) return forced as Season;
  return seasonFor(chicagoDate());
}

const META: Record<Season, { icon: string; badge: string; themeColor: string }> = {
  halloween: { icon: "🎃", badge: "Halloween Edition", themeColor: "#140a1c" },
  fall: { icon: "🍂", badge: "Fall Edition", themeColor: "#150d07" },
  christmas: { icon: "🎄", badge: "Holiday Edition", themeColor: "#06140c" },
};

export function seasonBadge(season: Season | null) {
  return season ? `${META[season].icon} ${META[season].badge}` : null;
}

/** Applies the season to <html data-season>, the favicon and the browser theme color. */
export function useSeason(season: Season | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (!season) {
      delete root.dataset.season;
      return;
    }
    root.dataset.season = season;
    const m = META[season];
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", m.themeColor);
    document
      .querySelector('link[rel="icon"]')
      ?.setAttribute(
        "href",
        `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${m.icon}</text></svg>`,
      );
  }, [season]);
}

// deterministic pseudo-random so the layout doesn't jump between renders
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const PIECES: Record<Season, { glyphs: string[]; count: number; kind: string }> = {
  halloween: { glyphs: ["🦇", "🦇", "🦇", "👻", "🎃"], count: 12, kind: "fly" },
  fall: { glyphs: ["🍂", "🍁", "🍂", "🍁", "🌾"], count: 16, kind: "fall" },
  christmas: { glyphs: ["❄", "•", "•", "❅", "•", "•"], count: 36, kind: "snow" },
};

/** Purely decorative background layer: bats and ghosts, falling leaves, or snow. */
export function SeasonLayer({ season }: { season: Season | null }) {
  const pieces = useMemo(() => {
    if (!season) return [];
    const p = PIECES[season];
    return Array.from({ length: p.count }, (_, i) => ({
      glyph: p.glyphs[i % p.glyphs.length],
      style: {
        left: `${Math.round(rand(i, 1) * 100)}%`,
        top: p.kind === "fly" ? `${Math.round(5 + rand(i, 2) * 80)}%` : undefined,
        fontSize: `${Math.round((p.kind === "snow" ? 8 : 16) + rand(i, 3) * (p.kind === "snow" ? 14 : 18))}px`,
        animationDuration: `${Math.round((p.kind === "snow" ? 9 : 14) + rand(i, 4) * 14)}s`,
        animationDelay: `${-Math.round(rand(i, 5) * 30)}s`,
        "--drift": `${Math.round(rand(i, 6) * 80 - 40)}px`,
      } as React.CSSProperties,
    }));
  }, [season]);
  if (!season) return null;
  return (
    <div className={`season-layer ${PIECES[season].kind}`} aria-hidden="true">
      {season === "halloween" && <div className="moon" />}
      {season === "christmas" && <div className="lights" />}
      {pieces.map((p, i) => (
        <span key={i} className="piece" style={p.style}>
          {p.glyph}
        </span>
      ))}
    </div>
  );
}
