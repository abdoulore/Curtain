import { z } from "zod";
import { parseEventLogs } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { verifyGateToken } from "@/server/gate-token";
import { address, bytes32, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { sendContract } from "@/server/relay";

const body = z.object({
  event: address,
  ticketId: uint,
  gate: z.object({
    event: address,
    gateNonce: bytes32,
    challengeBlock: z.string().regex(/^\d+$/),
    exp: z.number().int(),
    tag: bytes32,
  }),
  auth: z.object({
    r: bytes32,
    s: bytes32,
    challengeIndex: uint,
    typeIndex: uint,
    authenticatorData: hexBytes,
    clientDataJSON: z.string().max(2048),
  }),
});

/** The buyer's phone sends its passkey assertion over the gate's nonce; the gate key submits it. */
export async function POST(request: Request) {
  try {
    const { event, ticketId, gate, auth } = await parse(request, body);
    verifyGateToken(gate, event);
    const eventAddress = await assertCurtainEvent(event);
    const sent = await sendContract(walletFor(env.gateKey()), {
      address: eventAddress,
      abi: curtainEventAbi,
      functionName: "checkIn",
      args: [ticketId, gate.gateNonce, BigInt(gate.challengeBlock), auth],
    });
    const [checkedIn] = parseEventLogs({ abi: curtainEventAbi, logs: sent.receipt.logs, eventName: "CheckedIn" });
    return ok({
      hash: sent.hash,
      explorer: txUrl(sent.hash),
      ticketId: checkedIn?.args.ticketId,
      released: checkedIn?.args.amount,
      estimate: sent.estimate,
      gasLimit: sent.gasLimit,
    });
  } catch (error) {
    return fail(error);
  }
}
