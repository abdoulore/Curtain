"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { curtainFactoryAbi } from "./abis";
import { CURTAIN_FACTORY, RETIRED_FACTORIES } from "./chain";
import { findEvent, withDetails, type EventMeta } from "./events";
import { browserClient } from "./reads";

const cache = new Map<string, Promise<{ name: string; venue: string } | undefined>>();

async function detailsFrom(factory: Address, event: Address) {
  const [name, venue] = await browserClient
    .readContract({ address: factory, abi: curtainFactoryAbi, functionName: "details", args: [event] })
    .catch(() => ["", ""] as const);
  return name ? { name, venue } : undefined;
}

/**
 * The name and venue stored by the factory when the show was created, trying earlier factories for older shows.
 * Read once per page load.
 */
export function readShowDetails(event: Address) {
  const key = event.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      for (const factory of [CURTAIN_FACTORY, ...RETIRED_FACTORIES]) {
        const found = await detailsFrom(factory, event);
        if (found) return found;
      }
      return undefined;
    })();
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Whether a show has a real name and venue: true for catalogued shows or once the factory's details arrive, false
 * once they arrive empty, undefined while loading. Unnamed shows are kept out of lists.
 */
export function useShowNamed(event: Address | undefined): boolean | undefined {
  const known = event ? findEvent(event) : undefined;
  const catalogued = Boolean(known && known.name !== "Curtain event");
  const [result, setResult] = useState<{ event: Address; named: boolean }>();
  useEffect(() => {
    if (!event || catalogued) return;
    let alive = true;
    readShowDetails(event).then((d) => alive && setResult({ event, named: Boolean(d?.name.trim() && d.venue.trim()) }));
    return () => {
      alive = false;
    };
  }, [event, catalogued]);
  if (!event) return undefined;
  if (catalogued) return true;
  return result?.event === event ? result.named : undefined;
}

/** Event metadata for client views that only know the address. */
export function useShowMeta(event: Address | undefined): EventMeta | undefined {
  const base = event ? findEvent(event) : undefined;
  const [details, setDetails] = useState<{ event: Address; name: string; venue: string }>();
  useEffect(() => {
    if (!event) return;
    let alive = true;
    readShowDetails(event).then((d) => alive && d && setDetails({ event, ...d }));
    return () => {
      alive = false;
    };
  }, [event]);
  if (!base) return undefined;
  return withDetails(base, details?.event === event ? details : undefined);
}
