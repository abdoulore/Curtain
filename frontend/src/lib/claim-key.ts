import { concat, encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * A one-time claim key for one ticket, derived from the holder's passkey PRF output. Nothing is stored: the holder
 * can rebuild it on demand, and `generation` (the ticket's claim nonce once the link is set) makes every new link a
 * new key, so revoking or replacing a link kills the old one even though it carried its key.
 */
export function deriveClaimKey(prfOutput: Uint8Array, event: Address, ticketId: bigint, generation: bigint): Hex {
  let key = keccak256(
    concat([
      prfOutput,
      toBytes("curtain/claim-key/v1"),
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
        [event, ticketId, generation],
      ),
    ]),
  );
  // A keccak output is a valid secp256k1 key except with negligible probability; rehash if not.
  while (BigInt(key) === 0n || BigInt(key) >= SECP256K1_N) key = keccak256(key);
  return key;
}

/** What the "Send to my phone" QR carries. The key travels in the URL fragment, which never reaches a server. */
export type ClaimLink = { event: Address; ticketId: bigint; key: Hex };

export function claimUrl(origin: string, link: ClaimLink): string {
  const compact = JSON.stringify({ e: link.event, t: link.ticketId.toString(), k: link.key });
  return `${origin}/claim#${btoa(compact).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function parseClaimFragment(fragment: string): ClaimLink | null {
  try {
    const b64 = fragment.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4)));
    if (!/^0x[0-9a-fA-F]{40}$/.test(c.e) || !/^\d+$/.test(c.t) || !/^0x[0-9a-fA-F]{64}$/.test(c.k)) return null;
    return { event: c.e, ticketId: BigInt(c.t), key: c.k };
  } catch {
    return null;
  }
}
