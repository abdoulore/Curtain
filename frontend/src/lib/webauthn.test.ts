import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat } from "viem";
import { creationOptions, derToRS, ES256, inAppBrowser, P256_N, parseDer, pickDoorKey, recoverDoorKeys } from "./webauthn";

const enc = new TextEncoder();

function assertion(secret: Uint8Array, challenge: string) {
  const authenticatorData = concat([sha256(enc.encode("curtaintickets.vercel.app")), new Uint8Array([0x1d, 0, 0, 0, 0])]);
  const clientDataJSON = enc.encode(`{"type":"webauthn.get","challenge":"${challenge}","origin":"https://curtaintickets.vercel.app"}`);
  // Authenticators may return high-s signatures; recovery must work either way.
  const sig = p256.sign(concat([authenticatorData, sha256(clientDataJSON)]), secret, { lowS: false, format: "der" });
  return { authenticatorData, clientDataJSON, sig };
}

describe("creationOptions", () => {
  it("asks for ES256 only and evaluates PRF", () => {
    const opts = creationOptions({
      rp: { id: "curtaintickets.vercel.app", name: "Curtain" },
      user: { id: new Uint8Array(16), name: "ada", displayName: "Ada" },
      challenge: new Uint8Array(32),
      prfSalt: new Uint8Array(32),
      residentKey: "required",
      userVerification: "required",
      attestation: "none",
    });
    expect(opts.pubKeyCredParams).toEqual([{ type: "public-key", alg: ES256 }]);
    expect(opts.authenticatorSelection?.userVerification).toBe("required");
    expect((opts.extensions as { prf?: unknown }).prf).toBeDefined();
  });
});

describe("door key recovery", () => {
  const secret = p256.utils.randomSecretKey();
  const point = p256.getPublicKey(secret, false);
  const truth = { qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33)) };

  it("recovers two candidates, one of them the passkey's key", () => {
    const a = assertion(secret, "first");
    const keys = recoverDoorKeys(a.authenticatorData, a.clientDataJSON, a.sig);
    expect(keys.length).toBe(2);
    expect(keys).toContainEqual(truth);
  });

  it("a second signature narrows the candidates to the real key", () => {
    const a = assertion(secret, "first");
    const b = assertion(secret, "second");
    const picked = pickDoorKey(
      recoverDoorKeys(a.authenticatorData, a.clientDataJSON, a.sig),
      recoverDoorKeys(b.authenticatorData, b.clientDataJSON, b.sig),
    );
    expect(picked).toEqual(truth);
  });

  it("normalizes s low for the escrow", () => {
    const a = assertion(secret, "third");
    const { s } = derToRS(a.sig);
    expect(BigInt(s) <= P256_N / 2n).toBe(true);
    expect(parseDer(a.sig).r).toBe(BigInt(derToRS(a.sig).r));
  });
});

describe("inAppBrowser", () => {
  it("spots in-app browsers that cannot use passkeys", () => {
    expect(inAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 WhatsApp/2.24")).toBe("WhatsApp");
    expect(inAppBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Twitter for iPhone/10.0")).toBe("X");
    expect(inAppBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 Instagram 350.0")).toBe("Instagram");
    expect(inAppBrowser("Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Version/4.0 Chrome/131.0 Mobile Safari/537.36")).toBe("an app");
  });

  it("leaves real browsers alone", () => {
    expect(inAppBrowser("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36")).toBeNull();
    expect(inAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBeNull();
    expect(inAppBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36")).toBeNull();
  });
});
