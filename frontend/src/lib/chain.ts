import { defineChain, type Address } from "viem";

/** Monad testnet. Reads from the browser go to the public RPC; the server uses Alchemy first. */
export const PUBLIC_RPC_URL = "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL = "https://testnet.monadvision.com";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [PUBLIC_RPC_URL] } },
  blockExplorers: { default: { name: "MonadVision", url: EXPLORER_URL } },
});

export const CURTAIN_FACTORY: Address = "0x13391D9E0dD62d01c62821671F47A12eE320Ca58";
export const DEMO_EVENT: Address = "0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D";

/** Circle USDC on Monad testnet. Its EIP-712 domain is name "USDC", version "2". */
export const USDC: Address = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
export const USDC_PERMIT_DOMAIN = { name: "USDC", version: "2", chainId: monadTestnet.id, verifyingContract: USDC } as const;

/** Passkeys and Mera accounts are bound to this domain; never change it. */
export const RP_ID = "curtaintickets.vercel.app";

export const CURTAIN_EIP712 = { name: "Curtain", version: "1" } as const;
export const FACTORY_EIP712 = { name: "CurtainFactory", version: "1", chainId: 10143, verifyingContract: CURTAIN_FACTORY } as const;

export const buyIntentTypes = {
  BuyIntent: [
    { name: "buyer", type: "address" },
    { name: "ticketId", type: "uint256" },
    { name: "qx", type: "bytes32" },
    { name: "qy", type: "bytes32" },
    { name: "price", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** A gate device signs each nonce it shows, so the relayer can submit the check-in. */
export const gatePassTypes = {
  GatePass: [
    { name: "gateNonce", type: "bytes32" },
    { name: "challengeBlock", type: "uint256" },
  ],
} as const;

/** A ticket holder lists at or below face value; zero delists. */
export const listTypes = {
  List: [
    { name: "ticketId", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** An organizer creates a show; the relayer submits `createEventFor`. Must match CurtainFactory. */
export const createShowTypes = {
  CreateShow: [
    { name: "organizer", type: "address" },
    { name: "name", type: "string" },
    { name: "venue", type: "string" },
    { name: "show", type: "Show" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  Show: [
    { name: "payout", type: "address" },
    { name: "token", type: "address" },
    { name: "price", type: "uint96" },
    { name: "capacity", type: "uint32" },
    { name: "salesEnd", type: "uint64" },
    { name: "doorsOpen", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "settleDelay", type: "uint64" },
    { name: "heldThresholdBps", type: "uint16" },
    { name: "maxChallengeAge", type: "uint32" },
    { name: "rpIdHash", type: "bytes32" },
    { name: "gates", type: "address[]" },
  ],
} as const;

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
