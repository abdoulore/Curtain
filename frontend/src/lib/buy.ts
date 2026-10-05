"use client";

import { erc20Abi, parseAbi, parseSignature, type Address, type Hash, type LocalAccount } from "viem";
import { curtainEventAbi } from "./abis";
import { buyIntentTypes, CURTAIN_EIP712, monadTestnet, permitTypes, USDC, USDC_PERMIT_DOMAIN } from "./chain";
import type { StoredAccount } from "./account";
import { postJson } from "./api";
import { browserClient } from "./reads";

const permitNoncesAbi = parseAbi(["function nonces(address owner) view returns (uint256)"]);

export type BuyResult = { ticketId: string; hash: Hash; explorer: string };

/**
 * Signs a BuyIntent (binding this account and its door passkey) and a USDC permit, then hands both to the
 * relayer, which pays gas. Call `unlock` first, straight from the tap, so the biometric prompt is not delayed.
 */
export async function buyTicket(event: Address, stored: StoredAccount, account: LocalAccount, price: bigint): Promise<BuyResult> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
  const [nonce, permitNonce] = await Promise.all([
    browserClient.readContract({ address: event, abi: curtainEventAbi, functionName: "nonces", args: [account.address] }),
    browserClient.readContract({ address: USDC, abi: permitNoncesAbi, functionName: "nonces", args: [account.address] }),
  ]);

  const intent = { buyer: account.address, qx: stored.qx, qy: stored.qy, price, nonce, deadline };
  const buyerSig = await account.signTypedData({
    domain: { ...CURTAIN_EIP712, chainId: monadTestnet.id, verifyingContract: event },
    types: buyIntentTypes,
    primaryType: "BuyIntent",
    message: intent,
  });
  const permitSig = await account.signTypedData({
    domain: USDC_PERMIT_DOMAIN,
    types: permitTypes,
    primaryType: "Permit",
    message: { owner: account.address, spender: event, value: price, nonce: permitNonce, deadline },
  });
  const { r, s, v, yParity } = parseSignature(permitSig);
  const permit = { value: price, deadline, v: Number(v ?? BigInt(yParity + 27)), r, s };

  return postJson<BuyResult>("/api/relay/buy", { event, intent, buyerSig, permit });
}

export async function requestTopup(address: Address) {
  return postJson<{ toppedUp: boolean; balance: string }>("/api/topup", { address });
}

export async function hasBalanceFor(owner: Address, price: bigint): Promise<boolean> {
  const balance = await browserClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  return balance >= price;
}
