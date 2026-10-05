import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
  type TypedDataDefinition,
} from "viem";
import { CURTAIN_EIP712, gatePassTypes, monadTestnet } from "./chain";

/**
 * What the gate's rotating QR carries: a fresh nonce, the block it was made at, and the gate device's signature
 * over both. The contract accepts the check-in only if that signer is a gate the organizer paired.
 */
export type GateToken = { event: Address; gateNonce: Hex; challengeBlock: string; pass: Hex };

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** event (20) + gate nonce (32) + challenge block (8) + gate pass signature (65) bytes. */
const TOKEN_BYTES = 125;

/**
 * The QR holds a link, so any phone camera opens the check-in page. The token rides in the fragment, which never
 * reaches a server log.
 */
export function checkInUrl(origin: string, token: GateToken): string {
  const packed = concat([token.event, token.gateNonce, toHex(BigInt(token.challengeBlock), { size: 8 }), token.pass]);
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
      pass: bytesToHex(b.slice(60, 125)),
    };
  } catch {
    return null;
  }
}

/** Must match CurtainEvent.GATE_PASS_TYPEHASH under the event's EIP-712 domain. */
export function gatePassTypedData(event: Address, gateNonce: Hex, challengeBlock: bigint): TypedDataDefinition {
  return {
    domain: { ...CURTAIN_EIP712, chainId: monadTestnet.id, verifyingContract: event },
    types: gatePassTypes,
    primaryType: "GatePass",
    message: { gateNonce, challengeBlock },
  };
}

/** Makes one rotating gate code: a random nonce at the current block, signed by the paired device. */
export async function issueGateToken(device: LocalAccount, event: Address, challengeBlock: bigint): Promise<GateToken> {
  const gateNonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const pass = await device.signTypedData(gatePassTypedData(event, gateNonce, challengeBlock));
  return { event: getAddress(event), gateNonce, challengeBlock: challengeBlock.toString(), pass };
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

// ---------------------------------------------------------------------------
// Pairing a gate device
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A short name for a gate device, shown on the dashboard and on the gate screen so staff can match them. */
export function gateCode(gate: Address): string {
  let bits = BigInt(gate.slice(0, 2 + 10)); // first 5 bytes = 40 bits = 8 characters
  let out = "";
  for (let i = 0; i < 8; i++) {
    out = CROCKFORD[Number(bits & 31n)]! + out;
    bits >>= 5n;
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** The pairing QR hands the tablet its gate key for one show: event (20) + key (32) bytes. */
export function pairingUrl(origin: string, event: Address, gateKey: Hex): string {
  return `${origin}/gate/pair#${b64url(hexToBytes(concat([event, gateKey])))}`;
}

export function parsePairingFragment(fragment: string): { event: Address; gateKey: Hex } | null {
  try {
    const b = fromB64url(fragment.replace(/^#/, ""));
    if (b.length !== 52) return null;
    return { event: getAddress(bytesToHex(b.slice(0, 20))), gateKey: bytesToHex(b.slice(20, 52)) };
  } catch {
    return null;
  }
}

/** The gate screen proves it is a paired device when it asks for recent results. */
export const gateResultsMessage = (event: Address, at: number) => `Curtain gate results ${getAddress(event)} ${at}`;
