import { z } from "zod";
import { getAddress, parseEventLogs, sha256, toBytes } from "viem";
import { curtainFactoryAbi } from "@/lib/abis";
import { CURTAIN_FACTORY, RP_ID, txUrl } from "@/lib/chain";
import { MAX_CAPACITY } from "@/lib/create-show";
import { walletFor } from "@/server/clients";
import { env } from "@/server/env";
import { isSupportedToken } from "@/server/events";
import { address, bytes32, fail, hexBytes, ok, parse, uint } from "@/server/http";
import { clientIp, enforceCreateLimits, limitStore } from "@/server/limits";
import { RelayError, sendContract } from "@/server/relay";

const body = z.object({
  organizer: address,
  name: z.string().min(1).max(80),
  venue: z.string().min(1).max(120),
  params: z.object({
    payout: address,
    token: address,
    price: uint,
    capacity: z.number().int().min(1).max(MAX_CAPACITY),
    salesEnd: uint,
    doorsOpen: uint,
    endTime: uint,
    settleDelay: uint,
    heldThresholdBps: z.number().int().min(0).max(10_000),
    maxChallengeAge: z.number().int().min(0).max(10_000),
    maxPerBuyer: z.number().int().min(0).max(1_000),
    rpIdHash: bytes32,
    gates: z.array(address).max(10),
  }),
  nonce: uint,
  deadline: uint,
  sig: hexBytes,
});

const OUR_RP_ID_HASH = sha256(toBytes(RP_ID));

/**
 * The organizer's passkey account signs CreateShow; the relayer submits createEventFor and pays gas. The relayer
 * only pays for shows priced in testnet USDC whose passkeys belong to this site.
 */
export async function POST(request: Request) {
  try {
    const { organizer, name, venue, params, nonce, deadline, sig } = await parse(request, body);
    if (!isSupportedToken(params.token)) {
      throw new RelayError(400, "UnsupportedToken", "Shows on Curtain are priced in testnet USDC for now");
    }
    if (params.rpIdHash.toLowerCase() !== OUR_RP_ID_HASH) {
      throw new RelayError(400, "WrongRpId", "Shows must accept passkeys made for this site");
    }
    await enforceCreateLimits(limitStore(), clientIp(request));
    const sent = await sendContract(walletFor(env.relayerKey()), {
      address: CURTAIN_FACTORY,
      abi: curtainFactoryAbi,
      functionName: "createEventFor",
      args: [organizer, params, name, venue, nonce, deadline, sig],
    });
    const [created] = parseEventLogs({ abi: curtainFactoryAbi, logs: sent.receipt.logs, eventName: "EventCreated" });
    if (!created) throw new RelayError(502, "NotCreated", "The show was not created");
    return ok({ event: getAddress(created.args.eventAddress), hash: sent.hash, explorer: txUrl(sent.hash) });
  } catch (error) {
    return fail(error);
  }
}
