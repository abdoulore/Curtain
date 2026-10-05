import { describe, expect, it } from "vitest";
import { checkInUrl, parseCheckInFragment, type GateToken } from "./gate";

const token: GateToken = {
  event: "0xd3F22B52F74D658318C29E0475E1833214eCA005",
  gateNonce: `0x${"ab".repeat(32)}`,
  challengeBlock: "68406874",
  exp: 1791205670,
  tag: `0x${"cd".repeat(32)}`,
};

describe("gate QR link", () => {
  it("round-trips the token", () => {
    const url = checkInUrl("https://curtaintickets.vercel.app", token);
    expect(parseCheckInFragment(url.slice(url.indexOf("#")))).toEqual(token);
  });

  it("stays short enough for a sparse QR", () => {
    expect(checkInUrl("https://curtaintickets.vercel.app", token).length).toBeLessThanOrEqual(180);
  });

  it("rejects a truncated or junk fragment", () => {
    expect(parseCheckInFragment("#abc")).toBeNull();
    expect(parseCheckInFragment("#!!!")).toBeNull();
  });
});
