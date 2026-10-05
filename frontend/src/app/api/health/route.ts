import { erc20Abi, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "@/lib/abis";
import { DEMO_EVENT, monadTestnet, USDC } from "@/lib/chain";
import { publicClient } from "@/server/clients";
import { env } from "@/server/env";
import { fail, ok } from "@/server/http";

/** Operator view: the relayer, gate and treasury keys (three different accounts), their funding, and the demo event. */
export async function GET() {
  try {
    const relayer = privateKeyToAccount(env.relayerKey()).address;
    const gate = privateKeyToAccount(env.gateKey()).address;
    const treasury = privateKeyToAccount(env.treasuryKey()).address;
    const [block, relayerMon, gateMon, treasuryUsdc, gateRegistered, organizer] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getBalance({ address: relayer }),
      publicClient.getBalance({ address: gate }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }),
      publicClient.readContract({ address: DEMO_EVENT, abi: curtainEventAbi, functionName: "isGate", args: [gate] }),
      publicClient.readContract({ address: DEMO_EVENT, abi: curtainEventAbi, functionName: "organizer" }),
    ]);
    return ok({
      chainId: monadTestnet.id,
      block,
      rpc: env.alchemyApiKey() ? "alchemy+public" : "public",
      relayer: { address: relayer, mon: formatEther(relayerMon) },
      gate: { address: gate, mon: formatEther(gateMon), registeredOnDemoEvent: gateRegistered },
      treasury: { address: treasury, usdc: formatUnits(treasuryUsdc, 6) },
      // The organizer signs from their own device; their key is never on this server.
      demoEvent: { address: DEMO_EVENT, organizer },
    });
  } catch (error) {
    return fail(error);
  }
}
