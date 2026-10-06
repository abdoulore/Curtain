"use client";

import { useEffect, useState } from "react";
import { getAddress, type Address, type LocalAccount } from "viem";
import { postForm } from "./api";
import { descriptionHash, mediaMessage, NO_POSTER, posterHash, type ShowMedia } from "./show-media";

const cache = new Map<string, Promise<ShowMedia | null>>();

/** Posters and descriptions for several shows in one request, remembered for the page's lifetime. */
export function readShowsMedia(events: readonly Address[]): Promise<Record<string, ShowMedia | null>> {
  const missing = events.map((e) => getAddress(e)).filter((e) => !cache.has(e.toLowerCase()));
  if (missing.length > 0) {
    const batch: Promise<Record<string, ShowMedia | null>> = fetch(`/api/shows/media?events=${missing.join(",")}`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, ShowMedia | null>>) : {}))
      .catch(() => ({}));
    for (const e of missing) cache.set(e.toLowerCase(), batch.then((all) => all[e] ?? null));
  }
  return Promise.all(events.map(async (e) => [getAddress(e), await cache.get(e.toLowerCase())!] as const)).then(
    Object.fromEntries,
  );
}

export function useShowsMedia(events: readonly Address[]): Record<string, ShowMedia | null> {
  const key = events.map((e) => e.toLowerCase()).join(",");
  const [media, setMedia] = useState<{ key: string; value: Record<string, ShowMedia | null> }>({ key: "", value: {} });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    readShowsMedia(key.split(",") as Address[]).then((value) => alive && setMedia({ key, value }));
    return () => {
      alive = false;
    };
  }, [key]);
  return media.key === key ? media.value : {};
}

export function useShowMedia(event: Address | undefined): ShowMedia | null {
  const all = useShowsMedia(event ? [event] : []);
  return event ? (all[getAddress(event)] ?? null) : null;
}

/** Signs the show address and the exact file and text with the organizer's account, then uploads both. */
export async function uploadShowMedia(event: Address, signer: LocalAccount, poster: File | null, description: string) {
  const bytes = poster ? new Uint8Array(await poster.arrayBuffer()) : null;
  const message = mediaMessage(event, bytes ? posterHash(bytes) : NO_POSTER, descriptionHash(description));
  const sig = await signer.signMessage({ message });
  const form = new FormData();
  if (poster) form.set("poster", poster);
  form.set("description", description);
  form.set("sig", sig);
  const meta = await postForm<ShowMedia>(`/api/shows/${event}/media`, form);
  cache.set(event.toLowerCase(), Promise.resolve(meta));
  return meta;
}
