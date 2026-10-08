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

export const CURTAIN_FACTORY: Address = "0xd22f6eb461A97b9cA1b66837AfAb2E8D937F83bF";
export const DEMO_EVENT: Address = "0x6385e193b18c4291Da556121e6E9eCF04b384672";
/** Receives the Chainlink workflow's reports; its `pending` view is also what the relayer's daily keeper asks. */
export const CURTAIN_KEEPER: Address = "0xC157558da8C7d90EAE75C38A850515567ED5a18E";

/** Earlier factories, newest first. Shows made there keep working, so their names are still looked up. */
export const RETIRED_FACTORIES: readonly Address[] = [
  "0x5e2366072A6db0e0734bBb8976F86a7Eac6Fb3b6",
  "0x13391D9E0dD62d01c62821671F47A12eE320Ca58",
  "0x00CC023C3BFB01eb3E5470247c7976966b04d0Db",
  "0x4F50565d089A2D12117e6dc52375C2c8F748Bfc0",
];
/** Demo shows from earlier deployments, which people may still hold tickets for. */
export const RETIRED_DEMOS: readonly Address[] = [
  "0xa01EFA5Bc1cDB594A6Ec70d2Bd1b1138B496CB0E",
  "0x5562bF1ccBabcF2f060239f9D241Ba9661217135",
  "0x4Dc6c2eC3899C28BADdFe872B09c6c41C7dD653D",
  "0xd3F22B52F74D658318C29E0475E1833214eCA005",
  "0x8df8b6D5CeF9FE34B1a6bE4E130a589Be4bB5cB7",
];

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
    { name: "maxChallengeAge", type: "uint32" },
    { name: "maxPerBuyer", type: "uint16" },
    { name: "rpIdHash", type: "bytes32" },
    { name: "gates", type: "address[]" },
  ],
} as const;

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
