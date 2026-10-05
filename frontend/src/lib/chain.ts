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

export const CURTAIN_FACTORY: Address = "0x00CC023C3BFB01eb3E5470247c7976966b04d0Db";
export const DEMO_EVENT: Address = "0xd3F22B52F74D658318C29E0475E1833214eCA005";

/** Circle USDC on Monad testnet. Its EIP-712 domain is name "USDC", version "2". */
export const USDC: Address = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
export const USDC_PERMIT_DOMAIN = { name: "USDC", version: "2", chainId: monadTestnet.id, verifyingContract: USDC } as const;

/** Passkeys and Mera accounts are bound to this domain; never change it. */
export const RP_ID = "curtaintickets.vercel.app";

export const CURTAIN_EIP712 = { name: "Curtain", version: "1" } as const;

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

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
