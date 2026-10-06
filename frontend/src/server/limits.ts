import "server-only";
import { RelayError } from "./relay";

/** Counts hits per key inside a window. Upstash Redis when configured, so caps hold across serverless instances. */
export interface CounterStore {
  /** Increments `key` and returns the new count. The count expires `windowSeconds` after its first hit. */
  hit(key: string, windowSeconds: number): Promise<number>;
}

export function memoryStore(now: () => number = Date.now): CounterStore {
  const counts = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowSeconds) {
      const t = now();
      const entry = counts.get(key);
      if (!entry || entry.resetAt <= t) {
        counts.set(key, { count: 1, resetAt: t + windowSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
  };
}

/** Upstash REST (the Vercel Marketplace integration sets KV_REST_API_URL and KV_REST_API_TOKEN). */
export function upstashStore(url: string, token: string): CounterStore {
  return {
    async hit(key, windowSeconds) {
      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(windowSeconds), "NX"],
        ]),
      });
      if (!res.ok) throw new RelayError(503, "LimitStoreUnavailable", "Top-ups are paused for a moment. Try again soon.");
      const [incr] = (await res.json()) as [{ result: number }];
      return incr.result;
    },
  };
}

let shared: CounterStore | undefined;

export function limitStore(): CounterStore {
  if (shared) return shared;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  shared = url && token ? upstashStore(url, token) : memoryStore();
  return shared;
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

/** The treasury must cover the top-up; otherwise say so plainly instead of failing the transfer. */
/** Enough MON for a few top-up transfers at testnet gas prices. */
export const MIN_TREASURY_GAS = 20_000_000_000_000_000n; // 0.02 MON

export function assertTreasuryCovers(treasuryBalance: bigint, amount: bigint, treasuryGas = MIN_TREASURY_GAS) {
  if (treasuryBalance < amount || treasuryGas < MIN_TREASURY_GAS) {
    throw new RelayError(503, "DemoMoneyRefilling", "Demo money is being refilled. Try again in a few minutes.");
  }
}
