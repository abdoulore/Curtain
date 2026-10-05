import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "@/lib/abis";
import { publicClient } from "@/server/clients";
import { env } from "@/server/env";
import { assertCurtainEvent } from "@/server/events";
import { checkGateAccessCode, issueGateToken } from "@/server/gate-token";
import { address, fail, ok, parse } from "@/server/http";
import { RelayError } from "@/server/relay";

const body = z.object({ event: address, code: z.string().min(1) });

/** A gate screen asks for a fresh nonce every few seconds and shows it as a QR. */
export async function POST(request: Request) {
  try {
    const { event, code } = await parse(request, body);
    checkGateAccessCode(code);
    const eventAddress = await assertCurtainEvent(event);
    const gate = privateKeyToAccount(env.gateKey()).address;
    const [isGate, block] = await Promise.all([
      publicClient.readContract({ address: eventAddress, abi: curtainEventAbi, functionName: "isGate", args: [gate] }),
      publicClient.getBlockNumber(),
    ]);
    if (!isGate) throw new RelayError(409, "GateNotRegistered", `Gate ${gate} is not registered for this event`);
    return ok(issueGateToken(eventAddress, block));
  } catch (error) {
    return fail(error);
  }
}
