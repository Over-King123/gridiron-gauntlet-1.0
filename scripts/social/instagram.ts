// Minimal Instagram Graph API client for publishing a Reel from a local MP4.
// Uses the resumable upload flow (container -> rupload -> poll -> publish), so no public video URL is needed.
// Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads

import fs from "node:fs";

export interface IgConfig {
  userId: string;
  token: string;
  version?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** how long to wait for Instagram to process the video */
  timeoutMs?: number;
}

export class InstagramError extends Error {}

export class Instagram {
  private v: string;
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  constructor(private cfg: IgConfig) {
    this.v = cfg.version || "v26.0";
    this.f = cfg.fetch ?? fetch;
    this.sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private get graph() {
    return `https://graph.facebook.com/${this.v}`;
  }

  private async call(method: "GET" | "POST", url: string, params: Record<string, string> = {}) {
    const u = new URL(url);
    let body: string | undefined;
    if (method === "GET") for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    else body = new URLSearchParams(params).toString();
    const res = await this.f(u, {
      method,
      headers: { Authorization: `OAuth ${this.cfg.token}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new InstagramError(`Instagram ${method} ${u.pathname}: ${json.error?.message ?? res.status}`);
    return json;
  }

  /** Confirms the token works for this account; returns the @username. */
  async whoami(): Promise<string> {
    const j = await this.call("GET", `${this.graph}/${this.cfg.userId}`, { fields: "username" });
    return j.username;
  }

  /** Captions of the account's latest posts with timestamps (to avoid double-posting on a re-run). */
  async recent(limit = 5): Promise<{ caption: string; timestamp: string; permalink?: string }[]> {
    const j = await this.call("GET", `${this.graph}/${this.cfg.userId}/media`, { fields: "caption,timestamp,permalink", limit: String(limit) });
    return (j.data ?? []).map((m: any) => ({ caption: m.caption ?? "", timestamp: m.timestamp, permalink: m.permalink }));
  }

  async publishReel(videoPath: string, caption: string, opts: { thumbOffsetMs?: number } = {}): Promise<{ mediaId: string; permalink?: string }> {
    // 1. container
    const params: Record<string, string> = { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true" };
    if (opts.thumbOffsetMs != null) params.thumb_offset = String(Math.round(opts.thumbOffsetMs));
    const container = await this.call("POST", `${this.graph}/${this.cfg.userId}/media`, params);
    const id: string = container.id;
    const uploadUri: string = container.uri ?? `https://rupload.facebook.com/ig-api-upload/${this.v}/${id}`;

    // 2. upload bytes
    const bytes = fs.readFileSync(videoPath);
    const up = await this.f(uploadUri, {
      method: "POST",
      headers: { Authorization: `OAuth ${this.cfg.token}`, offset: "0", file_size: String(bytes.length) },
      body: bytes,
    });
    const upJson: any = await up.json().catch(() => ({}));
    if (!up.ok || upJson.success === false || upJson.error) throw new InstagramError(`Upload failed: ${upJson.error?.message ?? upJson.debug_info?.message ?? up.status}`);

    // 3. wait for processing
    const deadline = Date.now() + (this.cfg.timeoutMs ?? 5 * 60_000);
    for (;;) {
      const s = await this.call("GET", `${this.graph}/${id}`, { fields: "status_code,status" });
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new InstagramError(`Instagram couldn't process the video: ${s.status ?? s.status_code}`);
      if (Date.now() > deadline) throw new InstagramError("Timed out waiting for Instagram to process the video");
      await this.sleep(5000);
    }

    // 4. publish
    const pub = await this.call("POST", `${this.graph}/${this.cfg.userId}/media_publish`, { creation_id: id });
    let permalink: string | undefined;
    try {
      permalink = (await this.call("GET", `${this.graph}/${pub.id}`, { fields: "permalink" })).permalink;
    } catch {}
    return { mediaId: pub.id, permalink };
  }
}
