import { z } from "zod";
import { parseEventLogs } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { address, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { sendContract } from "@/server/relay";

const body = z.object({
  event: address,
  ticketId: uint,
  claimKey: address, // the zero address revokes the link
  nonce: uint,
  deadline: uint,
  holderSig: hexBytes,
});

/** Gasless setClaim: the holder signs an EIP-712 SetClaim, the relayer submits. */
export async function POST(request: Request) {
  try {
    const { event, ticketId, claimKey, nonce, deadline, holderSig } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    const sent = await sendContract(walletFor(env.relayerKey()), {
      address: eventAddress,
      abi: curtainEventAbi,
      functionName: "setClaim",
      args: [ticketId, claimKey, nonce, deadline, holderSig],
    });
    const [set] = parseEventLogs({ abi: curtainEventAbi, logs: sent.receipt.logs, eventName: "ClaimSet" });
    return ok({ hash: sent.hash, explorer: txUrl(sent.hash), claimNonce: set?.args.claimNonce });
  } catch (error) {
    return fail(error);
  }
}
