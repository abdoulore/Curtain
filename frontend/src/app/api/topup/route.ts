import { z } from "zod";
import { erc20Abi } from "viem";
import { txUrl, USDC } from "@/lib/chain";
import { publicClient, walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { address, fail, ok, parse } from "@/server/http";
import { clientIp, enforceTopupLimits, limitStore } from "@/server/limits";
import { sendContract } from "@/server/relay";

const body = z.object({ address });

/** Only tops up accounts holding less than this, so one account cannot drain the treasury. */
const LOW_BALANCE = 1_000_000n; // 1 USDC

/** Testnet only: sends a new account a little USDC from the treasury. Buyers never need MON. */
export async function POST(request: Request) {
  try {
    const { address: to } = await parse(request, body);
    const balance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [to] });
    if (balance >= LOW_BALANCE) return ok({ toppedUp: false, balance });
    // Counted only when money would actually move: per network per day, and for the whole app per hour.
    await enforceTopupLimits(limitStore(), clientIp(request));

    const amount = env.topupAmount();
    const sent = await sendContract(walletFor(env.treasuryKey()), {
      address: USDC,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
    });
    return ok({ toppedUp: true, amount, balance: balance + amount, hash: sent.hash, explorer: txUrl(sent.hash) });
  } catch (error) {
    return fail(error);
  }
}
