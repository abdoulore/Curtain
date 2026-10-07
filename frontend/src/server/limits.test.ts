import { describe, expect, it } from "vitest";
import {
  assertTopupsOpen,
  clientIp,
  enforceCreateLimits,
  enforceTopupLimits,
  memoryStore,
  storeFor,
  topupPause,
  upstashStore,
} from "./limits";

const limits = { perIpPerDay: 3, globalPerHour: 5 };

describe("top-up limits", () => {
  it("lets a network top up three times a day, then refuses with TopupLimitIp", async () => {
    const store = memoryStore(() => 0);
    for (let i = 0; i < 3; i++) await enforceTopupLimits(store, "1.1.1.1", limits);
    await expect(enforceTopupLimits(store, "1.1.1.1", limits)).rejects.toMatchObject({
      status: 429,
      code: "TopupLimitIp",
    });
    // Another network is unaffected.
    await expect(enforceTopupLimits(store, "2.2.2.2", limits)).resolves.toBeUndefined();
  });

  it("caps the whole app per hour with TopupLimitGlobal", async () => {
    const store = memoryStore(() => 0);
    for (let i = 0; i < 5; i++) await enforceTopupLimits(store, `10.0.0.${i}`, limits);
    await expect(enforceTopupLimits(store, "10.0.0.99", limits)).rejects.toMatchObject({
      status: 429,
      code: "TopupLimitGlobal",
    });
  });

  it("opens again when the window passes", async () => {
    let now = 0;
    const store = memoryStore(() => now);
    for (let i = 0; i < 5; i++) await enforceTopupLimits(store, `10.0.0.${i}`, limits);
    await expect(enforceTopupLimits(store, "10.0.0.99", limits)).rejects.toMatchObject({ code: "TopupLimitGlobal" });
    now = 60 * 60 * 1000 + 1;
    await expect(enforceTopupLimits(store, "10.0.0.99", limits)).resolves.toBeUndefined();
  });

  it("reads the first forwarded address", () => {
    const req = new Request("https://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(clientIp(req)).toBe("203.0.113.7");
    expect(clientIp(new Request("https://x"))).toBe("unknown");
  });
});

describe("show creation limits", () => {
  it("caps a network per day and the app per hour", async () => {
    const store = memoryStore(() => 0);
    const caps = { perIpPerDay: 2, globalPerHour: 2 };
    await enforceCreateLimits(store, "1.1.1.1", caps);
    await enforceCreateLimits(store, "1.1.1.1", caps);
    await expect(enforceCreateLimits(store, "1.1.1.1", caps)).rejects.toMatchObject({ status: 429, code: "CreateLimitIp" });
    await expect(enforceCreateLimits(store, "2.2.2.2", caps)).rejects.toMatchObject({ status: 429, code: "CreateLimitGlobal" });
  });

  it("counts separately from top-ups", async () => {
    const store = memoryStore(() => 0);
    for (let i = 0; i < 3; i++) await enforceTopupLimits(store, "1.1.1.1", limits);
    await expect(enforceCreateLimits(store, "1.1.1.1", { perIpPerDay: 1, globalPerHour: 1 })).resolves.toBeUndefined();
  });
});

const MON = 1_000_000_000_000_000_000n;
const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe("top-up pause", () => {
  const healthy = { treasuryUsdc: 9_000_000n, treasuryMon: MON, relayerMon: MON };

  it("stays open while the treasury and relayer can both cover a top-up", () => {
    expect(topupPause(healthy, 3_000_000n)).toBeNull();
    expect(() => assertTopupsOpen(healthy, 3_000_000n)).not.toThrow();
  });

  it("pauses when the treasury is short of demo money or gas, or the relayer is low", () => {
    expect(topupPause({ ...healthy, treasuryUsdc: 1_000_000n }, 3_000_000n)).toBe("treasury-usdc");
    expect(topupPause({ ...healthy, treasuryMon: 1n }, 3_000_000n)).toBe("treasury-gas");
    expect(topupPause({ ...healthy, relayerMon: MON / 10n }, 3_000_000n)).toBe("relayer-gas");
    expect(() => assertTopupsOpen({ ...healthy, relayerMon: 0n }, 3_000_000n)).toThrow(
      expect.objectContaining({ status: 503, code: "DemoMoneyRefilling" }),
    );
  });
});

describe("counter stores", () => {
  it("adds and reads totals in memory, and forgets them after the window", async () => {
    let now = 0;
    const store = memoryStore(() => now);
    expect(await store.add("k", 500, 10)).toBe(500);
    expect(await store.add("k", 250, 10)).toBe(750);
    expect(await store.get("k")).toBe(750);
    now = 10_001;
    expect(await store.get("k")).toBe(0);
  });

  it("fails closed in production when Upstash isn't configured", async () => {
    const store = storeFor(env({ VERCEL_ENV: "production" }));
    expect(store.kind).toBe("missing");
    await expect(enforceTopupLimits(store, "1.1.1.1", limits)).rejects.toMatchObject({ status: 503, code: "LimitStoreUnavailable" });
  });

  it("counts in memory on preview and local runs, and in Upstash when its keys are set", () => {
    expect(storeFor(env({ VERCEL_ENV: "preview" })).kind).toBe("memory");
    expect(storeFor(env({})).kind).toBe("memory");
    const keys = { VERCEL_ENV: "production", KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" };
    expect(storeFor(env(keys)).kind).toBe("upstash");
  });

  it("sends INCRBY with a first-hit expiry to Upstash and reads the total back", async () => {
    const sent: unknown[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify([{ result: 42 }, { result: 1 }]));
    }) as typeof fetch;
    expect(await upstashStore("https://kv.example", "t", fake).add("gas:buy:2026-10-07", 40, 60)).toBe(42);
    expect(sent[0]).toEqual([
      ["INCRBY", "gas:buy:2026-10-07", "40"],
      ["EXPIRE", "gas:buy:2026-10-07", "60", "NX"],
    ]);
  });

  it("reads Upstash being down or erroring as paused", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const erroring = (async () => new Response(JSON.stringify([{ error: "WRONGTYPE" }]))) as typeof fetch;
    const unauthorized = (async () => new Response("no", { status: 401 })) as typeof fetch;
    for (const request of [down, erroring, unauthorized]) {
      await expect(upstashStore("https://kv.example", "t", request).hit("k", 60)).rejects.toMatchObject({
        status: 503,
        code: "LimitStoreUnavailable",
      });
    }
  });
});
