import { getAddress, isAddress, type Address, type Hex } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { publicClient } from "@/server/clients";
import { assertCurtainEvent } from "@/server/events";
import { fail, ok } from "@/server/http";
import { RelayError } from "@/server/relay";
import { blobStore, saveShowMedia } from "@/server/show-media";

const organizerOf = (event: Address) =>
  publicClient.readContract({ address: event, abi: curtainEventAbi, functionName: "organizer" });

/**
 * The organizer sets a show's poster and description. The form carries the file, the text and the organizer's
 * passkey-account signature over the show address and both hashes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    if (!isAddress(address)) throw new RelayError(400, "UnknownEvent", "Not a Curtain event");
    const event = await assertCurtainEvent(getAddress(address));
    const form = await request.formData();
    const file = form.get("poster");
    const description = String(form.get("description") ?? "");
    const sig = String(form.get("sig") ?? "") as Hex;
    const poster =
      file instanceof File && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type } : undefined;
    const meta = await saveShowMedia(event, { poster, description, sig }, organizerOf, blobStore);
    return ok(meta);
  } catch (error) {
    return fail(error);
  }
}
