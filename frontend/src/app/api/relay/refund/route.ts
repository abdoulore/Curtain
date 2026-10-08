import { z } from "zod";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { publicClient, walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { gasGuard } from "@/server/gas-budget";
import { address, fail, ok, parse, uint } from "@/server/http";
import { isRefundable, keepShow, readShowState } from "@/server/keeper";
import { RelayError, sendContract } from "@/server/relay";

const body = z.object({ event: address, ticketId: uint.optional() });

/** CurtainEvent.TicketState values that can still be refunded: Active (1) and RefundOwed (3). */
const REFUNDABLE_TICKET = new Set([1, 3]);

/** Refund batches each wait for their receipt, so allow more than the default time. */
export const maxDuration = 60;

/**
 * Gets refund money moving for a show that didn't happen: settles it if its time has come, then pays the given
 * ticket (or the next refund batch). Anyone may ask; the contract only ever pays a ticket's current holder, and the
 * relayer pays the gas.
 */
export async function POST(request: Request) {
  try {
    const { event, ticketId } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    const hashes = await keepShow(eventAddress, 1);

    if (ticketId !== undefined && isRefundable((await readShowState(eventAddress)).status)) {
      const ticket = await publicClient.readContract({
        address: eventAddress,
        abi: curtainEventAbi,
        functionName: "getTicket",
        args: [ticketId],
      });
      if (REFUNDABLE_TICKET.has(Number(ticket.state))) {
        const sent = await sendContract(
          walletFor(env.relayerKey()),
          { address: eventAddress, abi: curtainEventAbi, functionName: "claimRefund", args: [ticketId] },
          gasGuard("keeper"),
        );
        hashes.push(sent.hash);
      }
    }

    const state = await readShowState(eventAddress);
    if (hashes.length === 0 && !isRefundable(state.status)) {
      throw new RelayError(400, "NotRefundable", "This show isn't refunding tickets");
    }
    return ok({ hashes, explorer: hashes.map(txUrl), status: state.status });
  } catch (error) {
    return fail(error);
  }
}
