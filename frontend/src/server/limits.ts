import "server-only";
import { RelayError } from "./relay";

/** Counts per key inside a window. Upstash Redis when configured, so caps hold across serverless instances. */
export interface CounterStore {
  /** Where the counts live: shared across instances (Upstash), this instance only, or nowhere (refuses). */
  readonly kind: "upstash" | "memory" | "missing";
  /** Increments `key` and returns the new count. The count expires `windowSeconds` after its first hit. */
  hit(key: string, windowSeconds: number): Promise<number>;
  /** Adds `by` to `key` and returns the new total, with the same expiry rule. */
  add(key: string, by: number, windowSeconds: number): Promise<number>;
  /** The current total for `key`, 0 when unset. */
  get(key: string): Promise<number>;
}

export function memoryStore(now: () => number = Date.now): CounterStore {
  const counts = new Map<string, { count: number; resetAt: number }>();
  const live = (key: string) => {
    const entry = counts.get(key);
    return entry && entry.resetAt > now() ? entry : undefined;
  };
  const add = async (key: string, by: number, windowSeconds: number) => {
    const entry = live(key);
    if (!entry) {
      counts.set(key, { count: by, resetAt: now() + windowSeconds * 1000 });
      return by;
    }
    entry.count += by;
    return entry.count;
  };
  return {
    kind: "memory",
    hit: (key, windowSeconds) => add(key, 1, windowSeconds),
    add,
    get: async (key) => live(key)?.count ?? 0,
  };
}

const paused = () => new RelayError(503, "LimitStoreUnavailable", "Top-ups are paused for a moment. Try again soon.");

/** Production without Upstash: every count fails, so anything relying on shared limits stays shut. */
export function missingStore(): CounterStore {
  const shut = async (): Promise<number> => {
    throw paused();
  };
  return { kind: "missing", hit: shut, add: shut, get: shut };
}

/** Upstash REST (the Vercel Marketplace integration sets KV_REST_API_URL and KV_REST_API_TOKEN). */
export function upstashStore(url: string, token: string, request: typeof fetch = fetch): CounterStore {
  // Failing to reach Upstash, or an error inside the pipeline, reads as paused; the caller decides what that means.
  async function pipeline(commands: string[][]): Promise<{ result?: unknown; error?: string }[]> {
    const res = await request(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    }).catch(() => null);
    if (!res?.ok) throw paused();
    const out = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!Array.isArray(out) || out.some((r) => r.error)) throw paused();
    return out;
  }
  const add = async (key: string, by: number, windowSeconds: number) => {
    const [incr] = await pipeline([
      ["INCRBY", key, String(by)],
      ["EXPIRE", key, String(windowSeconds), "NX"],
    ]);
    return Number(incr!.result);
  };
  return {
    kind: "upstash",
    hit: (key, windowSeconds) => add(key, 1, windowSeconds),
    add,
    get: async (key) => Number((await pipeline([["GET", key]]))[0]!.result ?? 0),
  };
}

/** True on the live site. Preview and local runs may count in memory. */
export function isProduction(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.VERCEL_ENV === "production";
}

/**
 * The shared counter store: Upstash when configured (the Vercel Marketplace integration sets KV_REST_API_URL and
 * KV_REST_API_TOKEN); in production without it, a store that refuses, so top-ups fail closed; elsewhere, memory.
 */
export function storeFor(environment: NodeJS.ProcessEnv = process.env): CounterStore {
  const url = environment.KV_REST_API_URL ?? environment.UPSTASH_REDIS_REST_URL;
  const token = environment.KV_REST_API_TOKEN ?? environment.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore(url, token);
  return isProduction(environment) ? missingStore() : memoryStore();
}

let shared: CounterStore | undefined;

export function limitStore(): CounterStore {
  return (shared ??= storeFor());
}

export type TopupLimits = { perIpPerDay: number; globalPerHour: number };

export const DEFAULT_TOPUP_LIMITS: TopupLimits = {
  perIpPerDay: Number(process.env.TOPUP_PER_IP_PER_DAY ?? 3),
  globalPerHour: Number(process.env.TOPUP_GLOBAL_PER_HOUR ?? 10),
};

/** Throws a plain-language 429 once a network or the whole app has used its free test money. */
export async function enforceTopupLimits(store: CounterStore, ip: string, limits: TopupLimits = DEFAULT_TOPUP_LIMITS) {
  const ipCount = await store.hit(`topup:ip:${ip}`, 24 * 60 * 60);
  if (ipCount > limits.perIpPerDay) {
    throw new RelayError(
      429,
      "TopupLimitIp",
      "You've had your free test money for today on this network. Try again tomorrow.",
    );
  }
  const globalCount = await store.hit("topup:global", 60 * 60);
  if (globalCount > limits.globalPerHour) {
    throw new RelayError(429, "TopupLimitGlobal", "Lots of people are topping up right now. Try again in an hour.");
  }
}

/** The caller's IP as Vercel reports it. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** Show creation costs the relayer the most gas, so it is capped per network per day and for the app per hour. */
export const DEFAULT_CREATE_LIMITS = {
  perIpPerDay: Number(process.env.CREATE_PER_IP_PER_DAY ?? 5),
  globalPerHour: Number(process.env.CREATE_GLOBAL_PER_HOUR ?? 20),
};

export async function enforceCreateLimits(store: CounterStore, ip: string, limits = DEFAULT_CREATE_LIMITS) {
  if ((await store.hit(`create:ip:${ip}`, 24 * 60 * 60)) > limits.perIpPerDay) {
    throw new RelayError(429, "CreateLimitIp", "You've created the most shows allowed today from this network.");
  }
  if ((await store.hit("create:global", 60 * 60)) > limits.globalPerHour) {
    throw new RelayError(429, "CreateLimitGlobal", "Lots of shows are being created right now. Try again in an hour.");
  }
}

/** Enough MON for a few top-up transfers at testnet gas prices. */
export const MIN_TREASURY_GAS = 20_000_000_000_000_000n; // 0.02 MON
/** Below this the relayer can't carry many buys, so new buyers aren't handed money they couldn't spend. */
export const MIN_RELAYER_GAS = BigInt(process.env.MIN_RELAYER_GAS_WEI ?? "200000000000000000"); // 0.2 MON

export type Balances = { treasuryUsdc: bigint; treasuryMon: bigint; relayerMon: bigint };
export type TopupPause = "treasury-usdc" | "treasury-gas" | "relayer-gas";

/** Why top-ups should pause right now, or null when the treasury and the relayer can both cover one. */
export function topupPause(b: Balances, amount: bigint): TopupPause | null {
  if (b.treasuryUsdc < amount) return "treasury-usdc";
  if (b.treasuryMon < MIN_TREASURY_GAS) return "treasury-gas";
  if (b.relayerMon < MIN_RELAYER_GAS) return "relayer-gas";
  return null;
}

/** Pauses top-ups while the treasury or relayer is low, saying so plainly instead of failing the transfer. */
export function assertTopupsOpen(b: Balances, amount: bigint) {
  if (topupPause(b, amount)) {
    throw new RelayError(503, "DemoMoneyRefilling", "Demo money is being refilled. Try again in a few minutes.");
  }
}
