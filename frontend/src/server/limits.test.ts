import { describe, expect, it } from "vitest";
import { enforceCreateLimits, enforceTopupLimits, memoryStore, clientIp } from "./limits";

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
