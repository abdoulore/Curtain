import { z } from "zod";
import { txUrl } from "@/lib/chain";
import { curtainEventAbi } from "@/lib/abis";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { gasGuard } from "@/server/gas-budget";
import { address, bytes32, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { sendContract } from "@/server/relay";

const body = z.object({
  event: address,
  ticketId: uint,
  newHolder: address,
  qx: bytes32,
  qy: bytes32,
  claimSig: hexBytes,
});

/** Gasless claim: the new holder's phone signs with the link's claim key, the relayer submits. */
export async function POST(request: Request) {
  try {
    const { event, ticketId, newHolder, qx, qy, claimSig } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    const sent = await sendContract(
      walletFor(env.relayerKey()),
      {
        address: eventAddress,
        abi: curtainEventAbi,
        functionName: "claim",
        args: [ticketId, newHolder, qx, qy, claimSig],
      },
      gasGuard("claim"),
    );
    return ok({ hash: sent.hash, explorer: txUrl(sent.hash), ticketId });
  } catch (error) {
    return fail(error);
  }
}
