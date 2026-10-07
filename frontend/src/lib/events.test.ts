import { describe, expect, it } from "vitest";
import { DEMO_EVENT, RETIRED_DEMOS } from "./chain";
import { findEvent, withDetails } from "./events";

describe("findEvent", () => {
  it("finds the demo by slug and address", () => {
    expect(findEvent("demo")?.address).toBe(DEMO_EVENT);
    expect(findEvent(DEMO_EVENT.toLowerCase())?.slug).toBe("demo");
  });

  it("keeps the demo name on demo shows from earlier deployments", () => {
    const old = findEvent(RETIRED_DEMOS[0]!)!;
    expect(old.name).toBe("Curtain Demo Night");
    expect(old.address).toBe(RETIRED_DEMOS[0]);
    expect(old.slug).toBe(RETIRED_DEMOS[0]);
  });

  it("gives other shows a placeholder until their details load", () => {
    const meta = findEvent("0x1111111111111111111111111111111111111111")!;
    expect(meta.name).toBe("Curtain event");
    expect(withDetails(meta, { name: "Afrobeats Live", venue: "Muri Okunola Park" })).toMatchObject({
      name: "Afrobeats Live",
      venue: "Muri Okunola Park",
    });
  });

  it("rejects anything that isn't a slug or an address", () => {
    expect(findEvent("nope")).toBeUndefined();
  });
});
