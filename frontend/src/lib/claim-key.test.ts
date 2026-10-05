import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { claimUrl, deriveClaimKey, parseClaimFragment } from "./claim-key";

const EVENT = "0xd3F22B52F74D658318C29E0475E1833214eCA005";
const prf = new Uint8Array(32).map((_, i) => i + 7);

describe("claim keys", () => {
  it("are deterministic for the same passkey, ticket and generation", () => {
    expect(deriveClaimKey(prf, EVENT, 3n, 1n)).toBe(deriveClaimKey(prf, EVENT, 3n, 1n));
  });

  it("differ per ticket, per generation and per passkey, so a revoked link never comes back", () => {
    const base = deriveClaimKey(prf, EVENT, 3n, 1n);
    expect(deriveClaimKey(prf, EVENT, 4n, 1n)).not.toBe(base);
    expect(deriveClaimKey(prf, EVENT, 3n, 2n)).not.toBe(base);
    expect(deriveClaimKey(new Uint8Array(32), EVENT, 3n, 1n)).not.toBe(base);
  });

  it("is a usable signing key", () => {
    const key = deriveClaimKey(prf, EVENT, 3n, 1n);
    expect(privateKeyToAccount(key).address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("claim links", () => {
  it("round-trip through the URL fragment", () => {
    const link = { event: EVENT as `0x${string}`, ticketId: 12n, key: deriveClaimKey(prf, EVENT, 12n, 1n) };
    const url = claimUrl("https://curtaintickets.vercel.app", link);
    expect(url.startsWith("https://curtaintickets.vercel.app/claim#")).toBe(true);
    expect(parseClaimFragment(url.slice(url.indexOf("#")))).toEqual(link);
  });

  it("rejects junk", () => {
    expect(parseClaimFragment("#not-base64")).toBeNull();
    expect(parseClaimFragment(`#${btoa(JSON.stringify({ e: "0x1", t: "x", k: "0x2" }))}`)).toBeNull();
  });
});
