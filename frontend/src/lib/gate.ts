import { bytesToHex, concat, encodeAbiParameters, getAddress, hexToBytes, keccak256, toHex, type Address, type Hex } from "viem";
import { monadTestnet } from "./chain";

/** What the gate's rotating QR carries. Issued and HMAC-tagged by /api/gate/nonce; valid for 60 seconds. */
export type GateToken = { event: Address; gateNonce: Hex; challengeBlock: string; exp: number; tag: Hex };

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** event (20) + gate nonce (32) + challenge block (8) + expiry (4) + tag (32) bytes. */
const TOKEN_BYTES = 96;

/**
 * The QR holds a link, so any phone camera opens the check-in page. The token rides in the fragment (never sent to
 * a server log) as 96 packed bytes, which keeps the QR sparse enough to scan from across a door.
 */
export function checkInUrl(origin: string, token: GateToken): string {
  const packed = concat([
    token.event,
    token.gateNonce,
    toHex(BigInt(token.challengeBlock), { size: 8 }),
    toHex(token.exp, { size: 4 }),
    token.tag,
  ]);
  return `${origin}/checkin#${b64url(hexToBytes(packed))}`;
}

export function parseCheckInFragment(fragment: string): GateToken | null {
  try {
    const b = fromB64url(fragment.replace(/^#/, ""));
    if (b.length !== TOKEN_BYTES) return null;
    return {
      event: getAddress(bytesToHex(b.slice(0, 20))),
      gateNonce: bytesToHex(b.slice(20, 52)),
      challengeBlock: BigInt(bytesToHex(b.slice(52, 60))).toString(),
      exp: Number(BigInt(bytesToHex(b.slice(60, 64)))),
      tag: bytesToHex(b.slice(64, 96)),
    };
  } catch {
    return null;
  }
}

/** Must match CurtainEvent.challengeFor. */
export function challengeFor(event: Address, ticketId: bigint, gateNonce: Hex, challengeBlock: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }],
      [BigInt(monadTestnet.id), event, ticketId, gateNonce, challengeBlock],
    ),
  );
}
