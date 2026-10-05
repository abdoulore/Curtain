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

/**
 * Gasless purchase: the buyer signs, the relayer pays gas. An intent for ticket 0 buys a new ticket; an intent for a
 * listed ticket buys it on resale, paying the seller directly.
 */
export async function POST(request: Request) {
  try {
    const { event, intent, buyerSig, permit } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    const p = permit ?? { value: 0n, deadline: 0n, v: 0, r: zeroHash, s: zeroHash };
    const resale = intent.ticketId !== 0n;
    const sent = await sendContract(
      walletFor(env.relayerKey()),
      resale
        ? { address: eventAddress, abi: curtainEventAbi, functionName: "buyResale", args: [intent.ticketId, intent, buyerSig, p] }
        : { address: eventAddress, abi: curtainEventAbi, functionName: "buy", args: [intent, buyerSig, p] },
    );
    const [purchased] = parseEventLogs({ abi: curtainEventAbi, logs: sent.receipt.logs, eventName: "Purchased" });
    return ok({
      hash: sent.hash,
      explorer: txUrl(sent.hash),
      ticketId: resale ? intent.ticketId : purchased?.args.ticketId,
      resale,
      estimate: sent.estimate,
      gasLimit: sent.gasLimit,
    });
  } catch (error) {
    return fail(error);
  }
}
