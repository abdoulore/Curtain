import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { monadTestnet } from "./chain";

/** What the gate's rotating QR carries. Issued and HMAC-tagged by /api/gate/nonce; valid for 60 seconds. */
export type GateToken = { event: Address; gateNonce: Hex; challengeBlock: string; exp: number; tag: Hex };

/** The QR holds a link, so any phone camera opens the check-in page. The token rides in the fragment, never sent to a server log. */
export function checkInUrl(origin: string, token: GateToken): string {
  const compact = JSON.stringify({ e: token.event, n: token.gateNonce, b: token.challengeBlock, x: token.exp, t: token.tag });
  return `${origin}/checkin#${btoa(compact).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function parseCheckInFragment(fragment: string): GateToken | null {
  try {
    const b64 = fragment.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4)));
    if (typeof c.e !== "string" || typeof c.n !== "string" || typeof c.t !== "string") return null;
    return { event: c.e, gateNonce: c.n, challengeBlock: String(c.b), exp: Number(c.x), tag: c.t };
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
