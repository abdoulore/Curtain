import "server-only";
import { createPublicClient, createWalletClient, fallback, http, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { monadTestnet, PUBLIC_RPC_URL } from "@/lib/chain";
import { env } from "./env";

// Alchemy first, public RPC as fallback. No log queries or background polling go through here
// (the Alchemy free tier caps eth_getLogs at 10 blocks); history comes from Envio.
function transport() {
  const key = env.alchemyApiKey();
  const urls = key ? [`https://monad-testnet.g.alchemy.com/v2/${key}`, PUBLIC_RPC_URL] : [PUBLIC_RPC_URL];
  return fallback(urls.map((url) => http(url, { timeout: 15_000 })));
}

export const publicClient = createPublicClient({ chain: monadTestnet, transport: transport(), pollingInterval: 500 });

/** One shared nonce manager, so keys that are the same account never race each other in one instance. */
export function walletFor(key: Hex) {
  const account = privateKeyToAccount(key, { nonceManager });
  return createWalletClient({ account, chain: monadTestnet, transport: transport() });
}

export type Wallet = ReturnType<typeof walletFor>;
