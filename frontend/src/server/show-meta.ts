import "server-only";
import { curtainFactoryAbi } from "@/lib/abis";
import { CURTAIN_FACTORY } from "@/lib/chain";
import { findEvent, withDetails, type EventMeta } from "@/lib/events";
import { publicClient } from "./clients";

/** Server pages: catalog entry or address, plus the name and venue the organizer stored onchain. */
export async function loadEvent(id: string): Promise<EventMeta | undefined> {
  const meta = findEvent(id);
  if (!meta) return undefined;
  const details = await publicClient
    .readContract({ address: CURTAIN_FACTORY, abi: curtainFactoryAbi, functionName: "details", args: [meta.address] })
    .then(([name, venue]) => ({ name, venue }))
    .catch(() => undefined);
  return withDetails(meta, details);
}
