import { z } from "zod";
import { parseEventLogs } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { gasGuard } from "@/server/gas-budget";
import { address, bytes32, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { gateLog } from "@/server/gate-log";
import { RelayError, sendContract, toRelayError } from "@/server/relay";

const body = z.object({
  event: address,
  ticketId: uint,
  gate: z.object({
    event: address,
    gateNonce: bytes32,
    challengeBlock: z.string().regex(/^\d+$/),
    pass: hexBytes,
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

/**
 * The buyer's phone sends its passkey assertion over the gate's nonce, with the pass the gate device signed for that
 * nonce. The relayer submits; the contract checks the pass came from a paired gate.
 */
export async function POST(request: Request) {
  let parsed: z.output<typeof body> | undefined;
  try {
    parsed = await parse(request, body);
    const { event, ticketId, gate, auth } = parsed;
    if (gate.event !== event) throw new RelayError(400, "GateTokenWrongEvent", "That gate code is for another show");
    const eventAddress = await assertCurtainEvent(event);
    const sent = await sendContract(
      walletFor(env.relayerKey()),
      {
        address: eventAddress,
        abi: curtainEventAbi,
        functionName: "checkIn",
        args: [ticketId, gate.gateNonce, BigInt(gate.challengeBlock), gate.pass, auth],
      },
      gasGuard("checkin"),
    );
    const [checkedIn] = parseEventLogs({ abi: curtainEventAbi, logs: sent.receipt.logs, eventName: "CheckedIn" });
    await record(event, { at: Date.now(), ok: true, ticketId: ticketId.toString(), hash: sent.hash });
    return ok({
      hash: sent.hash,
      explorer: txUrl(sent.hash),
      ticketId: checkedIn?.args.ticketId,
      released: checkedIn?.args.amount,
      estimate: sent.estimate,
      gasLimit: sent.gasLimit,
    });
  } catch (error) {
    // Refused check-ins never reach the chain; the gate screen learns about them from this log.
    if (parsed) {
      await record(parsed.event, { at: Date.now(), ok: false, ticketId: parsed.ticketId.toString(), code: toRelayError(error).code });
    }
    return fail(error);
  }
}

async function record(event: string, result: Parameters<ReturnType<typeof gateLog>["push"]>[1]) {
  try {
    await gateLog().push(event, result);
  } catch {
    // The gate feed is best effort; never fail a check-in over it.
  }
}
