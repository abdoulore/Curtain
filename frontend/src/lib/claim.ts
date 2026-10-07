"use client";

import { zeroAddress, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "./abis";
import { unlock, unlockedPrf, type StoredAccount } from "./account";
import { postJson } from "./api";
import { CURTAIN_EIP712, monadTestnet } from "./chain";
import { claimUrl, deriveClaimKey, type ClaimLink } from "./claim-key";
import { PlainError } from "./errors";
import { browserClient, readTicket } from "./reads";
import type { DoorKey } from "./webauthn";

const setClaimTypes = {
  SetClaim: [
    { name: "ticketId", type: "uint256" },
    { name: "claimKey", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const claimTypes = {
  Claim: [
    { name: "ticketId", type: "uint256" },
    { name: "newHolder", type: "address" },
    { name: "qx", type: "bytes32" },
    { name: "qy", type: "bytes32" },
    { name: "claimNonce", type: "uint256" },
  ],
} as const;

const domain = (event: Address) => ({ ...CURTAIN_EIP712, chainId: monadTestnet.id, verifyingContract: event });

/** Holder signs SetClaim (gasless); the relayer submits. `claimKey` zero revokes. */
async function setClaim(stored: StoredAccount, event: Address, ticketId: bigint, claimKey: Address) {
  const { signer } = await unlock(stored);
  const nonce = await browserClient.readContract({
    address: event,
    abi: curtainEventAbi,
    functionName: "nonces",
    args: [signer.address],
  });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
  const holderSig = await signer.signTypedData({
    domain: domain(event),
    types: setClaimTypes,
    primaryType: "SetClaim",
    message: { ticketId, claimKey, nonce, deadline },
  });
  return postJson<{ hash: Hash; claimNonce: string }>("/api/relay/setclaim", {
    event,
    ticketId,
    claimKey,
    nonce,
    deadline,
    holderSig,
  });
}

/**
 * "Send to my phone" and gift links. Derives this link's claim key from the passkey's PRF output (one biometric
 * prompt if locked), registers its address on the ticket, and returns the link that carries the key.
 */
export async function createClaimLink(stored: StoredAccount, event: Address, ticketId: bigint): Promise<string> {
  await unlock(stored);
  const prf = unlockedPrf(stored.address);
  if (!prf) throw new PlainError("Please confirm with your fingerprint or Face ID first.");
  const { claimNonce } = await readTicket(event, ticketId);
  // setClaim bumps the claim nonce, so the new link's generation is the next one.
  const key = deriveClaimKey(prf, event, ticketId, claimNonce + 1n);
  await setClaim(stored, event, ticketId, privateKeyToAccount(key).address);
  return claimUrl(window.location.origin, { event, ticketId, key });
}

export async function revokeClaimLink(stored: StoredAccount, event: Address, ticketId: bigint) {
  await setClaim(stored, event, ticketId, zeroAddress);
}

/** The phone side: sign the claim with the link's key for this account and passkey; the relayer submits. */
export async function claimWithLink(link: ClaimLink, account: StoredAccount & DoorKey) {
  const ticket = await readTicket(link.event, link.ticketId);
  const claimer = privateKeyToAccount(link.key);
  if (ticket.claimKey === zeroAddress) throw new PlainError("This link was turned off by the ticket's owner.");
  if (ticket.claimKey.toLowerCase() !== claimer.address.toLowerCase()) {
    throw new PlainError("This link has been replaced by a newer one. Ask for a fresh link.");
  }
  const claimSig = await claimer.signTypedData({
    domain: domain(link.event),
    types: claimTypes,
    primaryType: "Claim",
    message: {
      ticketId: link.ticketId,
      newHolder: account.address,
      qx: account.qx,
      qy: account.qy,
      claimNonce: ticket.claimNonce,
    },
  });
  return postJson<{ hash: Hash; ticketId: string }>("/api/relay/claim", {
    event: link.event,
    ticketId: link.ticketId,
    newHolder: account.address,
    qx: account.qx,
    qy: account.qy,
    claimSig,
  });
}
