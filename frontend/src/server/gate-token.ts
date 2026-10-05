import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, toHex, type Address, type Hex } from "viem";
import { env } from "./env";
import { RelayError } from "./relay";

/** How long a gate QR stays valid. Kept inside the contract's 300 block window (about 90 seconds). */
export const GATE_TOKEN_TTL_SECONDS = 60;

export type GateToken = { event: Address; gateNonce: Hex; challengeBlock: string; exp: number; tag: Hex };

function tagFor(event: Address, gateNonce: Hex, challengeBlock: string, exp: number): Hex {
  const mac = createHmac("sha256", env.gateSecret());
  mac.update(`${getAddress(event)}|${gateNonce.toLowerCase()}|${challengeBlock}|${exp}`);
  return `0x${mac.digest("hex")}`;
}

/** Issued to a gate screen; shown as a rotating QR the buyer scans. */
export function issueGateToken(event: Address, challengeBlock: bigint): GateToken {
  const gateNonce = toHex(randomBytes(32));
  const exp = Math.floor(Date.now() / 1000) + GATE_TOKEN_TTL_SECONDS;
  const block = challengeBlock.toString();
  return { event: getAddress(event), gateNonce, challengeBlock: block, exp, tag: tagFor(event, gateNonce, block, exp) };
}

/** Proves the nonce came from one of our gate screens recently. The contract then enforces single use. */
export function verifyGateToken(token: GateToken, event: Address): void {
  if (getAddress(token.event) !== getAddress(event)) throw new RelayError(400, "GateTokenWrongEvent", "Gate code is for another event");
  if (token.exp < Math.floor(Date.now() / 1000)) throw new RelayError(400, "GateTokenExpired", "Gate code expired, scan again");
  const expected = Buffer.from(tagFor(event, token.gateNonce, token.challengeBlock, token.exp).slice(2), "hex");
  const given = Buffer.from(token.tag.slice(2), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new RelayError(400, "GateTokenInvalid", "Gate code was not issued by a Curtain gate");
  }
}

export function checkGateAccessCode(code: string): void {
  const expected = Buffer.from(env.gateAccessCode());
  const given = Buffer.from(code);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new RelayError(401, "GateUnauthorized", "Wrong gate access code");
  }
}
