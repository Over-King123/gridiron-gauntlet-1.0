import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Instagram } from "./instagram.ts";
import { HOOKS, pickQuestion, planReel, previousDay } from "./pick.ts";
import { reelHtml } from "./template.ts";

describe("reel plan", () => {
  it("uses a question from yesterday's Daily and never today's", () => {
    const plan = planReel("2026-10-14");
    expect(plan.sourceDate).toBe("2026-10-13");
    const yesterday = JSON.parse(fs.readFileSync("content/daily/2026-10-13.json", "utf8"));
    const today = JSON.parse(fs.readFileSync("content/daily/2026-10-14.json", "utf8"));
    expect(yesterday.map((q: any) => q.id)).toContain(plan.questionId);
    expect(today.map((q: any) => q.question)).not.toContain(plan.question);
  });
  it("keeps the right answer with its text after shuffling, and is deterministic", () => {
    const a = planReel("2026-10-14");
    const b = planReel("2026-10-14");
    expect(a).toEqual(b);
    const yesterday = JSON.parse(fs.readFileSync("content/daily/2026-10-13.json", "utf8"));
    const src = yesterday.find((q: any) => q.id === a.questionId);
    expect(a.answers[a.correctIndex]).toBe(src.answers[src.correctIndex]);
    expect(HOOKS).toContain(a.hook);
  });
  it("writes a caption with the question, options, today's Daily number and link in bio", () => {
    const p = planReel("2026-10-14");
    expect(p.caption).toContain(p.question);
    for (const a of p.answers) expect(p.caption).toContain(a);
    expect(p.caption).toContain(`Daily Gauntlet #${p.dailyNumber} (Hodgepodge Wednesday)`);
    expect(p.caption).toMatch(/Link in bio/);
    expect(p.caption.length).toBeLessThan(2200); // Instagram caption limit
  });
  it("prefers medium questions that fit on screen", () => {
    const set = JSON.parse(fs.readFileSync("content/daily/2026-10-13.json", "utf8"));
    const q = pickQuestion(set, "2026-10-14");
    expect(q.difficulty).toBe(2);
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
  });
  it("escapes question text in the reel HTML", () => {
    const p = { ...planReel("2026-10-14"), question: "<script>x</script> & co?" };
    expect(reelHtml(p)).toContain("&lt;script&gt;x&lt;/script&gt; &amp; co?");
  });
});

describe("Instagram publishing", () => {
  it("creates a resumable reel container, uploads, waits for processing, then publishes", async () => {
    const calls: { method: string; url: string; headers: any; body: any }[] = [];
    let polls = 0;
    const fakeFetch = (async (url: any, init: any) => {
      const u = String(url);
      calls.push({ method: init.method, url: u, headers: init.headers, body: init.body });
      const ok = (j: any) => new Response(JSON.stringify(j), { status: 200 });
      if (u.includes("rupload.facebook.com")) return ok({ success: true });
      if (u.endsWith("/123/media")) return ok({ id: "C1", uri: "https://rupload.facebook.com/ig-api-upload/v26.0/C1" });
      if (u.includes("/C1?")) return ok({ status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" });
      if (u.endsWith("/123/media_publish")) return ok({ id: "M9" });
      if (u.includes("/M9?")) return ok({ permalink: "https://instagram.com/reel/abc" });
      return new Response(JSON.stringify({ error: { message: "unexpected " + u } }), { status: 400 });
    }) as typeof fetch;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ig-")), "r.mp4");
    fs.writeFileSync(file, Buffer.alloc(1000, 1));
    const ig = new Instagram({ userId: "123", token: "TKN", fetch: fakeFetch, sleep: async () => {} });
    const res = await ig.publishReel(file, "hello", { thumbOffsetMs: 4100 });
    expect(res).toEqual({ mediaId: "M9", permalink: "https://instagram.com/reel/abc" });

    const create = calls[0];
    expect(create.url).toBe("https://graph.facebook.com/v26.0/123/media");
    const params = new URLSearchParams(create.body);
    expect(params.get("media_type")).toBe("REELS");
    expect(params.get("upload_type")).toBe("resumable");
    expect(params.get("caption")).toBe("hello");
    expect(params.get("thumb_offset")).toBe("4100");
    const upload = calls[1];
    expect(upload.headers).toMatchObject({ Authorization: "OAuth TKN", offset: "0", file_size: "1000" });
    expect(calls.filter((c) => c.url.includes("/C1?")).length).toBe(2);
    expect(new URLSearchParams(calls.find((c) => c.url.endsWith("/media_publish"))!.body).get("creation_id")).toBe("C1");
  });
  it("surfaces Instagram's error message", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 400 })) as typeof fetch;
    const ig = new Instagram({ userId: "1", token: "bad", fetch: fakeFetch });
    await expect(ig.whoami()).rejects.toThrow(/Invalid OAuth access token/);
  });
});
