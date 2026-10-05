import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat, hexToBytes, toHex, type Hex } from "viem";

export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** COSE ES256: ECDSA on P-256 with SHA-256, the only key type the escrow can verify at the door. */
export const ES256 = -7;

export type DoorKey = { qx: Hex; qy: Hex };

/** Fields of Mera's credential-creation request that shape the WebAuthn call. */
export type CreateRequest = {
  rp: { id: string; name: string };
  user: { id: BufferSource; name: string; displayName: string };
  challenge: BufferSource;
  prfSalt: BufferSource;
  residentKey: ResidentKeyRequirement;
  userVerification: UserVerificationRequirement;
  attestation: AttestationConveyancePreference;
  timeout?: number;
};

/**
 * Creation options for a Curtain passkey. Mera asks for ES256 or RS256; Curtain asks for ES256 only, so no device
 * makes a key the door cannot verify.
 */
export function creationOptions(req: CreateRequest): PublicKeyCredentialCreationOptions {
  return {
    rp: req.rp,
    user: req.user,
    challenge: req.challenge,
    pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
    ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
    attestation: req.attestation,
    authenticatorSelection: {
      residentKey: req.residentKey,
      requireResidentKey: true,
      userVerification: req.userVerification,
    },
    extensions: { prf: { eval: { first: req.prfSalt } } } as AuthenticationExtensionsClientInputs,
  };
}

/** Raw (r, s) from a DER ECDSA signature. */
export function parseDer(sig: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  if (sig[i++] !== 0x30) throw new Error("Unexpected signature format");
  i += sig[i]! & 0x80 ? 1 + (sig[i]! & 0x7f) : 1;
  const readInt = () => {
    if (sig[i++] !== 0x02) throw new Error("Unexpected signature format");
    const len = sig[i++]!;
    const value = BigInt(bytesToHex(sig.slice(i, i + len)));
    i += len;
    return value;
  };
  const r = readInt();
  const s = readInt();
  return { r, s };
}

/** (r, s) for the escrow, with s normalized low: OpenZeppelin's P256 rejects high-s signatures. */
export function derToRS(sig: Uint8Array): { r: Hex; s: Hex } {
  const { r, s } = parseDer(sig);
  const low = s > P256_N / 2n ? P256_N - s : s;
  return { r: toHex(r, { size: 32 }), s: toHex(low, { size: 32 }) };
}

/**
 * The two public keys that could have made a WebAuthn assertion signature. A passkey's public key is only handed
 * over at registration, so on a new browser we recover it from a signature instead; a second signature picks one.
 */
export function recoverDoorKeys(authenticatorData: Uint8Array, clientDataJSON: Uint8Array, signatureDer: Uint8Array) {
  const digest = sha256(concat([authenticatorData, sha256(clientDataJSON)]));
  const { r, s } = parseDer(signatureDer);
  const compact = concat([toHex(r, { size: 32 }), toHex(s, { size: 32 })]);
  const keys: DoorKey[] = [];
  for (const bit of [0, 1]) {
    try {
      const point = p256.Signature.fromBytes(hexToBytes(compact), "compact")
        .addRecoveryBit(bit)
        .recoverPublicKey(digest)
        .toBytes(false);
      keys.push({ qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33)) });
    } catch {
      // Not every recovery bit yields a point.
    }
  }
  return keys;
}

/** The one key both signatures agree on, or undefined if they do not narrow it to one. */
export function pickDoorKey(a: DoorKey[], b: DoorKey[]): DoorKey | undefined {
  const same = a.filter((x) => b.some((y) => y.qx.toLowerCase() === x.qx.toLowerCase() && y.qy.toLowerCase() === x.qy.toLowerCase()));
  return same.length === 1 ? same[0] : undefined;
}

/**
 * In-app browsers (WhatsApp, X, Instagram, Facebook, TikTok, Android WebViews) usually cannot use passkeys.
 * Returns the app's name so the page can ask the buyer to open Safari or Chrome.
 */
export function inAppBrowser(userAgent: string): string | null {
  const apps: [RegExp, string][] = [
    [/WhatsApp/i, "WhatsApp"],
    [/Twitter|TwitterAndroid/i, "X"],
    [/Instagram/i, "Instagram"],
    [/\bFBA[NV]\b|FB_IAB|FBIOS/i, "Facebook"],
    [/musical_ly|TikTok|BytedanceWebview/i, "TikTok"],
    [/Snapchat/i, "Snapchat"],
    [/\bLine\//i, "LINE"],
    [/; wv\)/, "an app"],
  ];
  return apps.find(([re]) => re.test(userAgent))?.[1] ?? null;
}
