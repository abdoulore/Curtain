import { z } from "zod";
import { curtainEventAbi } from "@/lib/abis";
import { publicClient } from "@/server/clients";
import { assertCurtainEvent } from "@/server/events";
import { verifyGateDevice } from "@/server/gate-auth";
import { gateLog } from "@/server/gate-log";
import { address, fail, hexBytes, ok, parse } from "@/server/http";

const body = z.object({ event: address, at: z.number().int(), sig: hexBytes });

/** The gate screen's feed of recent check-in attempts, green and red, newest first. Paired devices only. */
export async function POST(request: Request) {
  try {
    const { event, at, sig } = await parse(request, body);
    const eventAddress = await assertCurtainEvent(event);
    await verifyGateDevice(eventAddress, at, sig, (gate) =>
      publicClient.readContract({ address: eventAddress, abi: curtainEventAbi, functionName: "isGate", args: [gate] }),
    );
    return ok({ results: await gateLog().recent(eventAddress) });
  } catch (error) {
    return fail(error);
  }
}
