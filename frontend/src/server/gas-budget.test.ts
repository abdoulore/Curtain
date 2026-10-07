import { describe, expect, it, vi } from "vitest";
import { chargeGas, gasCeiling, gasKey, gasUsage, GAS_ROUTES } from "./gas-budget";
import { memoryStore, missingStore } from "./limits";

const DAY = 24 * 60 * 60 * 1000;
const env = (vars: Record<string, string> = {}) => vars as NodeJS.ProcessEnv;

describe("daily gas ceiling", () => {
  it("lets a route spend up to its ceiling, then refuses with GasCeiling", async () => {
    const store = memoryStore(() => 0);
    const caps = env({ GAS_CEILING_CHECKIN: "300000" });
    await chargeGas("checkin", 150_000n, store, 0, caps);
    await chargeGas("checkin", 150_000n, store, 0, caps);
    await expect(chargeGas("checkin", 1n, store, 0, caps)).rejects.toMatchObject({ status: 503, code: "GasCeiling" });
  });

  it("takes a refused charge back, so a smaller call still fits", async () => {
    const store = memoryStore(() => 0);
    const caps = env({ GAS_CEILING_BUY: "300000" });
    await chargeGas("buy", 250_000n, store, 0, caps);
    await expect(chargeGas("buy", 100_000n, store, 0, caps)).rejects.toMatchObject({ code: "GasCeiling" });
    expect(await store.get(gasKey("buy", 0))).toBe(250_000);
    await expect(chargeGas("buy", 50_000n, store, 0, caps)).resolves.toBeUndefined();
  });

  it("keeps each route's budget apart and starts fresh each UTC day", async () => {
    let now = Date.UTC(2026, 9, 7, 23);
    const store = memoryStore(() => now);
    const caps = env({ GAS_CEILING_CREATE: "400000" });
    await chargeGas("create", 400_000n, store, now, caps);
    await expect(chargeGas("create", 1n, store, now, caps)).rejects.toMatchObject({ code: "GasCeiling" });
    await expect(chargeGas("buy", 400_000n, store, now, caps)).resolves.toBeUndefined();
    now += 2 * 60 * 60 * 1000; // past midnight UTC
    await expect(chargeGas("create", 400_000n, store, now, caps)).resolves.toBeUndefined();
    expect(gasKey("create", now)).toBe("gas:create:2026-10-08");
  });

  it("lets transactions through when the shared store can't be reached, so the door keeps working", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(chargeGas("checkin", 100_000n, missingStore(), 0, env())).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("GasBudgetUnavailable", "checkin");
    error.mockRestore();
  });

  it("has a default ceiling for every route, overridable per route", () => {
    for (const route of GAS_ROUTES) expect(gasCeiling(route, env())).toBeGreaterThan(1_000_000);
    expect(gasCeiling("topup", env({ GAS_CEILING_TOPUP: "5" }))).toBe(5);
    expect(gasCeiling("topup", env({ GAS_CEILING_TOPUP: "nonsense" }))).toBe(gasCeiling("topup", env()));
  });

  it("reports today's use against each ceiling", async () => {
    const store = memoryStore(() => 0);
    await chargeGas("buy", 330_000n, store, 0, env());
    const usage = await gasUsage(store, 0);
    expect(usage.buy.used).toBe(330_000);
    expect(usage.checkin.used).toBe(0);
    expect(Object.keys(usage)).toEqual([...GAS_ROUTES]);
    expect((await gasUsage(store, DAY)).buy.used).toBe(0);
  });
});
