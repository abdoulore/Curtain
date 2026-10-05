import { z } from "zod";
import { parseEventLogs, zeroHash } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { address, bytes32, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { sendContract } from "@/server/relay";

const body = z.object({
  event: address,
  intent: z.object({
    buyer: address,
    ticketId: uint,
    qx: bytes32,
    qy: bytes32,
    price: uint,
    nonce: uint,
    deadline: uint,
  }),
  buyerSig: hexBytes,
  // Omit to rely on an existing allowance.
  permit: z
    .object({ value: uint, deadline: uint, v: z.number().int().min(0).max(255), r: bytes32, s: bytes32 })
    .nullish(),
});

/** Gasless primary purchase: the buyer signs, the relayer pays gas. */
export async function POST(request: Request) {
  try {
    const { event, intent, buyerSig, permit } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    const sent = await sendContract(walletFor(env.relayerKey()), {
      address: eventAddress,
      abi: curtainEventAbi,
      functionName: "buy",
      args: [intent, buyerSig, permit ?? { value: 0n, deadline: 0n, v: 0, r: zeroHash, s: zeroHash }],
    });
    const [purchased] = parseEventLogs({ abi: curtainEventAbi, logs: sent.receipt.logs, eventName: "Purchased" });
    return ok({
      hash: sent.hash,
      explorer: txUrl(sent.hash),
      ticketId: purchased?.args.ticketId,
      estimate: sent.estimate,
      gasLimit: sent.gasLimit,
    });
  } catch (error) {
    return fail(error);
  }
}
