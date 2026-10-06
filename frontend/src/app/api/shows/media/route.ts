import { getAddress, isAddress } from "viem";
import { metaPath, type ShowMedia } from "@/lib/show-media";
import { fail } from "@/server/http";
import { blobStore } from "@/server/show-media";

/** Posters and descriptions for up to 24 shows at once: /api/shows/media?events=0x..,0x.. */
export async function GET(request: Request) {
  try {
    const ids = (new URL(request.url).searchParams.get("events") ?? "")
      .split(",")
      .filter((a) => isAddress(a))
      .slice(0, 24)
      .map((a) => getAddress(a));
    const entries = await Promise.all(ids.map(async (a) => [a, await blobStore.getMeta(metaPath(a))] as const));
    const body: Record<string, ShowMedia | null> = Object.fromEntries(entries);
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": "public, s-maxage=30, stale-while-revalidate=300" },
    });
  } catch (error) {
    return fail(error);
  }
}
