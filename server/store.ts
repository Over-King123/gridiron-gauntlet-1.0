// Tiny key-value store used by Daily mode.
// Uses Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL/TOKEN are set,
// otherwise falls back to process memory (fine for local dev and tests, lost on restart).

export interface KV {
  readonly kind: "upstash" | "memory";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** set only if absent; returns true if this call set it */
  setNX(key: string, value: string, ttlSec: number): Promise<boolean>;
  hset(key: string, field: string, value: string, ttlSec: number): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  incr(key: string, ttlSec: number): Promise<number>;
}

export class MemoryKV implements KV {
  readonly kind = "memory" as const;
  private data = new Map<string, { v: any; exp: number }>();
  constructor(private now: () => number = Date.now) {}
  private live(key: string) {
    const e = this.data.get(key);
    if (e && e.exp <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    const e = this.live(key);
    return typeof e?.v === "string" ? e.v : null;
  }
  async set(key: string, value: string, ttl: number) {
    this.data.set(key, { v: value, exp: this.now() + ttl * 1000 });
  }
  async setNX(key: string, value: string, ttl: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }
  async hset(key: string, field: string, value: string, ttl: number) {
    const e = this.live(key);
    const h: Record<string, string> = e?.v && typeof e.v === "object" ? e.v : {};
    h[field] = value;
    this.data.set(key, { v: h, exp: this.now() + ttl * 1000 });
  }
  async hgetall(key: string) {
    const e = this.live(key);
    return e?.v && typeof e.v === "object" ? { ...e.v } : {};
  }
  async incr(key: string, ttl: number) {
    const e = this.live(key);
    const n = (Number(e?.v) || 0) + 1;
    this.data.set(key, { v: String(n), exp: e?.exp ?? this.now() + ttl * 1000 });
    return n;
  }
}

export class UpstashKV implements KV {
  readonly kind = "upstash" as const;
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async pipeline(cmds: (string | number)[][]): Promise<any[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
    const out = (await res.json()) as { result?: any; error?: string }[];
    const err = out.find((r) => r.error);
    if (err) throw new Error(`Upstash: ${err.error}`);
    return out.map((r) => r.result);
  }

  async get(key: string) {
    return (await this.pipeline([["GET", key]]))[0] ?? null;
  }
  async set(key: string, value: string, ttl: number) {
    await this.pipeline([["SET", key, value, "EX", ttl]]);
  }
  async setNX(key: string, value: string, ttl: number) {
    const [r] = await this.pipeline([["SET", key, value, "NX", "EX", ttl]]);
    return r === "OK";
  }
  async hset(key: string, field: string, value: string, ttl: number) {
    await this.pipeline([
      ["HSET", key, field, value],
      ["EXPIRE", key, ttl],
    ]);
  }
  async hgetall(key: string) {
    const [flat] = await this.pipeline([["HGETALL", key]]);
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out[flat[i]] = flat[i + 1];
    return out;
  }
  async incr(key: string, ttl: number) {
    const [n] = await this.pipeline([
      ["INCR", key],
      ["EXPIRE", key, ttl, "NX"],
    ]);
    return Number(n);
  }
}

export function createStore(): KV {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashKV(url, token);
  return new MemoryKV();
}
