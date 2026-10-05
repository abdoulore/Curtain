"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { curtainFactoryAbi } from "./abis";
import { CURTAIN_FACTORY } from "./chain";
import { findEvent, withDetails, type EventMeta } from "./events";
import { browserClient } from "./reads";

const cache = new Map<string, Promise<{ name: string; venue: string } | undefined>>();

/** The name and venue stored by the factory when the show was created. Read once per page load. */
export function readShowDetails(event: Address) {
  const key = event.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = browserClient
      .readContract({ address: CURTAIN_FACTORY, abi: curtainFactoryAbi, functionName: "details", args: [event] })
      .then(([name, venue]) => ({ name, venue }))
      .catch(() => undefined);
    cache.set(key, hit);
  }
  return hit;
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
