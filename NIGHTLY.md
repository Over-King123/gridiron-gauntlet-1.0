# Nightly Daily Gauntlet set

Each night a scheduled task writes the next day's Daily Gauntlet: 10 brand-new questions in
`content/daily/YYYY-MM-DD.json`, where the date is **tomorrow in America/Chicago**. These are the
standing rules for that task. Edit this file to change them.

## Steps

1. Work out tomorrow's date in America/Chicago. If `content/daily/<tomorrow>.json` already exists,
   target the next missing date instead, but never more than 3 days ahead. If those all exist, stop.
2. Read every existing question (`content/questions/*.json` and `content/daily/*.json`) so nothing
   is repeated or near-repeated: no same fact asked a different way, no same answer for the same feat.
3. Write 10 new questions following the content rules below.
4. Fact-check every question with web search before keeping it: the correct answer, each
   distractor being wrong, and every number, year and name in the question and explanation.
   Drop or replace anything that can't be confirmed from a reliable source (Pro Football Reference,
   Sports Reference CFB, ESPN, NFL.com, school or conference sites, major outlets).
5. Save the file, then run `npm install` (first time only), `npm run validate` and `npm test`. Fix
   anything they flag.
6. Commit with the message `Daily set for <date>` and push to `main`. Render deploys it automatically.

## Content rules

- **Exactly 10 questions:** 3 at difficulty 1, 4 at difficulty 2, 3 at difficulty 3. The game
  plays them easy to hard.
- **League mix:** at least 4 NFL and at least 4 FBS. College questions are FBS programs only; never
  FCS. (An NFL player's FCS college is fine as an NFL question.)
- **Era:** 1990 onward. At most one older question per day, and it must be iconic and carry
  `"tags": ["classic"]`.
- **Focus:** players first: careers, stat lines, draft slots, college-to-pro paths, awards, records,
  signature plays and big moments. Only an occasional coach, team or niche-rule question.
- **No Roman numerals:** write "Super Bowl 47", never "Super Bowl XLVII", in questions, answers
  and explanations.
- **Difficulty (raised Oct 2026; the whole set should feel hard):** even the openers must make a
  serious fan stop and think.
  - 1 = serious fan. The second layer of a famous moment or career: who threw the pass, who was
    the backup who took over, where a well-known player was picked. Never the headline fact.
  - 2 = diehard. Runner-ups, supporting players in big games, draft busts and trades, specific
    award winners outside the MVP/Heisman headline.
  - 3 = deep cut. Decoys and intended receivers, junior-college stops, co-leaders, exact numbers.
  - **Too easy, don't use at any level:** No. 1 overall picks from the last 15 years, "which
    college did <star> attend", Heisman, MVP or Super Bowl MVP winners, the obvious name behind a
    famous play, and anything most casual fans would get right.
  - Distractors should be tempting: players who were really involved or did something similar
    (the co-star of the play, the other QB in that draft), not filler names.
- **Exactly one objectively correct answer.** Three plausible distractors from the same world (same
  era, position, team or conference). No "all of the above" or trick answers.
- **Nothing that can change:** avoid "current", "active leader" and "still holds the record" unless
  phrased as of a fixed date ("set in 2019", "at the time").
- **Explanation:** one or two sentences that teach something beyond the answer.

## File format

```json
[
  {
    "id": "d20261008-01",
    "league": "NFL",
    "category": "players and careers",
    "difficulty": 1,
    "question": "...",
    "answers": ["correct answer", "wrong", "wrong", "wrong"],
    "correctIndex": 0,
    "explanation": "...",
    "source": "https://... (the page that confirmed it)"
  }
]
```

IDs are `d<YYYYMMDD>-01` through `-10`. The correct answer is always first with `correctIndex: 0`;
the server shuffles the order.

Once its date has passed, a set also joins the multiplayer question pool automatically.
