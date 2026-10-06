import { erc20Abi, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "@/lib/abis";
import { CURTAIN_FACTORY, DEMO_EVENT, monadTestnet, USDC } from "@/lib/chain";
import { publicClient } from "@/server/clients";
import { env } from "@/server/env";
import { fail, ok } from "@/server/http";

/**
 * Operator view: the relayer and treasury keys (two different accounts) and their funding, and the demo event.
 * Gate devices hold their own keys, paired per show, and only sign; organizers sign from their own devices.
 */
export async function GET() {
  try {
    const relayer = privateKeyToAccount(env.relayerKey()).address;
    const treasury = privateKeyToAccount(env.treasuryKey()).address;
    const [block, relayerMon, treasuryMon, treasuryUsdc, organizer] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getBalance({ address: relayer }),
      publicClient.getBalance({ address: treasury }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }),
      publicClient.readContract({ address: DEMO_EVENT, abi: curtainEventAbi, functionName: "organizer" }),
    ]);
    return ok({
      chainId: monadTestnet.id,
      block,
      rpc: env.alchemyApiKey() ? "alchemy+public" : "public",
      factory: CURTAIN_FACTORY,
      relayer: { address: relayer, mon: formatEther(relayerMon) },
      treasury: { address: treasury, usdc: formatUnits(treasuryUsdc, 6), mon: formatEther(treasuryMon) },
      demoEvent: { address: DEMO_EVENT, organizer },
    });
  } catch (error) {
    return fail(error);
  }
}
