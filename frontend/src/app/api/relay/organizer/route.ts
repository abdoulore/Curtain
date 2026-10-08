import { z } from "zod";
import { curtainEventAbi } from "@/lib/abis";
import { txUrl } from "@/lib/chain";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { gasGuard } from "@/server/gas-budget";
import { keepShow } from "@/server/keeper";
import { address, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { sendContract } from "@/server/relay";

const signed = { nonce: uint, deadline: uint, sig: hexBytes };
const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("withdraw"), event: address, amount: uint, ...signed }),
  z.object({ kind: z.literal("cancel"), event: address, ...signed }),
  z.object({ kind: z.literal("setGate"), event: address, gate: address, allowed: z.boolean(), ...signed }),
]);

/** Refund batches each wait for their receipt, so allow more than the default time. */
export const maxDuration = 60;

/** Organizer actions signed in the organizer's own wallet; the relayer submits and pays gas. */
export async function POST(request: Request) {
  try {
    const action = await parse(request, body);
    const event = await assertCurtainEvent(action.event);
    const { nonce, deadline, sig } = action;
    const call =
      action.kind === "withdraw"
        ? { functionName: "withdraw", args: [action.amount, nonce, deadline, sig] }
        : action.kind === "cancel"
          ? { functionName: "cancel", args: [nonce, deadline, sig] }
          : { functionName: "setGate", args: [action.gate, action.allowed, nonce, deadline, sig] };
    const sent = await sendContract(
      walletFor(env.relayerKey()),
      { address: event, abi: curtainEventAbi, ...call },
      gasGuard("organizer"),
    );
    // A cancelled show refunds straight away: the relayer pushes the refund batches right after the cancel.
    const refunds = action.kind === "cancel" ? await keepShow(event).catch(() => []) : [];
    return ok({ hash: sent.hash, explorer: txUrl(sent.hash), refunds });
  } catch (error) {
    return fail(error);
  }
}
