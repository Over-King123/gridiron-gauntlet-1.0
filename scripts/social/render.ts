// Renders the daily reel to MP4 (plus a cover image and caption), or the link-preview image.
//   npx tsx scripts/social/render.ts reel [YYYY-MM-DD] [outDir]
//   npx tsx scripts/social/render.ts og [outFile]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { chicagoDate } from "../../shared/themes.ts";
import { planReel, type ReelPlan } from "./pick.ts";
import { TIMELINE, ogHtml, reelHtml } from "./template.ts";

const FPS = 30;

async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

async function settle(page: import("playwright-core").Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

export async function renderReel(plan: ReelPlan, outDir: string): Promise<{ video: string; cover: string; caption: string }> {
  fs.mkdirSync(outDir, { recursive: true });
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), "gg-frames-"));
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.setContent(reelHtml(plan), { waitUntil: "networkidle" });
    await settle(page);
    const total = Math.round(TIMELINE.end * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => (window as any).setT(t), i / FPS);
      await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 92 });
    }
    // cover: the question with all four answers on screen, before the reveal
    await page.evaluate((t) => (window as any).setT(t), TIMELINE.countdownStart + 0.5);
    const cover = path.join(outDir, "cover.jpg");
    await page.screenshot({ path: cover, type: "jpeg", quality: 92 });

    const video = path.join(outDir, "reel.mp4");
    // H.264 + AAC (silent track) in MP4, the format Instagram Reels expects
    execFileSync(
      process.env.FFMPEG || "ffmpeg",
      [
        "-y", "-loglevel", "error",
        "-framerate", String(FPS), "-i", path.join(frames, "f%04d.jpg"),
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-profile:v", "high", "-r", String(FPS), "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        video,
      ],
      { stdio: "inherit" },
    );
    const caption = path.join(outDir, "caption.txt");
    fs.writeFileSync(caption, plan.caption + "\n");
    fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    return { video, cover, caption };
  } finally {
    await browser.close();
    fs.rmSync(frames, { recursive: true, force: true });
  }
}

export async function renderOg(outFile: string) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(ogHtml(), { waitUntil: "networkidle" });
    await settle(page);
    await page.screenshot({ path: outFile, type: "png" });
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "og") {
    await renderOg(a || "client/public/og.png");
    console.log("Wrote", a || "client/public/og.png");
  } else {
    const date = a || chicagoDate();
    const plan = planReel(date);
    const out = await renderReel(plan, b || path.join("out", "social", date));
    console.log(`Reel for ${date} (question ${plan.questionId} from ${plan.sourceDate}):`, out);
  }
}
