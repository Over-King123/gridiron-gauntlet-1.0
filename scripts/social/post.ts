// Daily Instagram post: render today's reel and publish it.
//   npx tsx scripts/social/post.ts [YYYY-MM-DD]
// Env: IG_USER_ID, IG_ACCESS_TOKEN (both required to publish), IG_GRAPH_VERSION (optional),
//      DRY_RUN=1 to render without posting. Without credentials it renders and stops (dry run).

import fs from "node:fs";
import path from "node:path";
import { chicagoDate } from "../../shared/themes.ts";
import { Instagram } from "./instagram.ts";
import { planReel } from "./pick.ts";
import { renderReel } from "./render.ts";
import { TIMELINE } from "./template.ts";

const date = process.argv[2] || chicagoDate();
const outDir = path.join("out", "social", date);
const userId = process.env.IG_USER_ID?.trim();
const token = process.env.IG_ACCESS_TOKEN?.trim();
const dry = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true" || !userId || !token;

const summary: string[] = [];
const note = (s: string) => {
  console.log(s);
  summary.push(s);
};

const ig = dry ? null : new Instagram({ userId: userId!, token: token!, version: process.env.IG_GRAPH_VERSION });

// check credentials before spending a minute rendering
if (ig) {
  const handle = await ig.whoami();
  note(`Posting as @${handle}`);
  const marker = `Daily Gauntlet #`;
  const plan = planReel(date);
  const dup = (await ig.recent(5)).find(
    (m) => m.caption.includes(`${marker}${plan.dailyNumber} `) || m.caption.includes(`${marker}${plan.dailyNumber}(`),
  );
  if (dup) {
    note(`Already posted today's reel (${dup.permalink ?? dup.timestamp}); nothing to do.`);
    writeSummary();
    process.exit(0);
  }
}

const plan = planReel(date);
note(`Reel for ${date}: question ${plan.questionId} from the ${plan.sourceDate} Daily (${plan.season ?? "standard"} look)`);
const out = await renderReel(plan, outDir);
note(`Rendered ${out.video}`);

if (!ig) {
  note(userId && token ? "DRY_RUN set: not posting." : "No Instagram credentials (IG_USER_ID / IG_ACCESS_TOKEN): rendered only, not posted.");
} else {
  const res = await ig.publishReel(out.video, plan.caption, { thumbOffsetMs: (TIMELINE.countdownStart + 0.5) * 1000 });
  note(`Published reel ${res.mediaId}${res.permalink ? `: ${res.permalink}` : ""}`);
}
writeSummary();

function writeSummary() {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const cap = fs.existsSync(path.join(outDir, "caption.txt")) ? fs.readFileSync(path.join(outDir, "caption.txt"), "utf8") : "";
  fs.appendFileSync(file, `## Instagram reel for ${date}\n\n${summary.map((s) => `- ${s}`).join("\n")}\n\n${cap ? "### Caption\n\n```\n" + cap + "```\n" : ""}`);
}
