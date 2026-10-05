import { z } from "zod";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { address, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { sendContract } from "@/server/relay";

const body = z.object({ event: address, ticketId: uint, price: uint, nonce: uint, deadline: uint, sig: hexBytes });

/** A holder puts a ticket on sale at face value or less (0 takes it off) by signature; the relayer pays gas. */
export async function POST(request: Request) {
  try {
    const { event, ticketId, price, nonce, deadline, sig } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    const sent = await sendContract(walletFor(env.relayerKey()), {
      address: eventAddress,
      abi: curtainEventAbi,
      functionName: "listForResale",
      args: [ticketId, price, nonce, deadline, sig],
    });
    return ok({ hash: sent.hash, explorer: txUrl(sent.hash) });
  } catch (error) {
    return fail(error);
  }
}
