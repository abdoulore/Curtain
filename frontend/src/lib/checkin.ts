"use client";

import { bytesToHex, hexToBytes, toHex, type Hash } from "viem";
import type { StoredAccount } from "./account";
import { postJson } from "./api";
import { RP_ID } from "./chain";
import { challengeFor, type GateToken } from "./gate";

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** DER ECDSA signature to (r, s), with s normalized low: the escrow rejects high-s signatures. */
function derToRS(sig: Uint8Array) {
  let i = 0;
  if (sig[i++] !== 0x30) throw new Error("Unexpected signature format");
  i += sig[i] & 0x80 ? 1 + (sig[i] & 0x7f) : 1;
  const readInt = () => {
    if (sig[i++] !== 0x02) throw new Error("Unexpected signature format");
    const len = sig[i++];
    const value = BigInt(bytesToHex(sig.slice(i, i + len)));
    i += len;
    return value;
  };
  const r = readInt();
  let s = readInt();
  if (s > P256_N / 2n) s = P256_N - s;
  return { r: toHex(r, { size: 32 }), s: toHex(s, { size: 32 }) };
}

const b64urlToBytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) =>
    c.charCodeAt(0),
  );

export type CheckInResult = { hash: Hash; explorer: string; ticketId: string; released: string };

/**
 * Signs the gate's challenge with the ticket's passkey and hands it to the gate relay. Call straight from a
 * tap: the challenge is computed locally, so the biometric prompt opens before any network call.
 */
export async function checkIn(token: GateToken, ticketId: bigint, account: StoredAccount): Promise<CheckInResult> {
  const challenge = challengeFor(token.event, ticketId, token.gateNonce, BigInt(token.challengeBlock));
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(challenge) as Uint8Array<ArrayBuffer>,
      rpId: RP_ID,
      userVerification: "required",
      timeout: 60_000,
      allowCredentials: [{ type: "public-key", id: b64urlToBytes(account.credentialId) }],
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Cancelled. Try again when you're ready.");

  const response = credential.response as AuthenticatorAssertionResponse;
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
  const { r, s } = derToRS(new Uint8Array(response.signature));
  const auth = {
    r,
    s,
    challengeIndex: clientDataJSON.indexOf('"challenge":"'),
    typeIndex: clientDataJSON.indexOf('"type":"webauthn.get"'),
    authenticatorData: bytesToHex(new Uint8Array(response.authenticatorData)),
    clientDataJSON,
  };
  return postJson<CheckInResult>("/api/relay/checkin", { event: token.event, ticketId, gate: token, auth });
}
