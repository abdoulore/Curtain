"use client";

import { getAddress, type Address } from "viem";
import { CURTAIN_FACTORY, DEMO_EVENT } from "./chain";
import { findEvent, HIDDEN_SHOWS } from "./events";
import { fetchOpenShows } from "./indexer";
import { browserClient, readEventInfo } from "./reads";
import { readShowDetails } from "./show-details";
import { factoryShowAddresses, upcomingShows, type ShowSummary } from "./upcoming";

/** Upcoming shows from the indexer, or read from the factory's clones when the indexer has nothing. */
export async function loadUpcoming(now: number): Promise<ShowSummary[]> {
  const indexed = await fetchOpenShows().catch(() => []);
  let shows: ShowSummary[] = indexed.map((r) => ({
    address: getAddress(r.id),
    name: r.name,
    venue: r.venue,
    price: BigInt(r.price),
    capacity: Number(r.capacity),
    sold: r.sold,
    doorsOpen: Number(r.doorsOpen),
    endTime: Number(r.endTime),
    status: r.status,
  }));
  if (shows.length === 0) shows = await fromChain();
  return upcomingShows(
    shows.map((s) => withCatalogName(s)),
    now,
    DEMO_EVENT,
    HIDDEN_SHOWS,
  );
}

async function fromChain(): Promise<ShowSummary[]> {
  const nonce = await browserClient.getTransactionCount({ address: CURTAIN_FACTORY });
  const addresses = factoryShowAddresses(CURTAIN_FACTORY, nonce, 12);
  const rows = await Promise.all(
    addresses.map(async (address): Promise<ShowSummary | null> => {
      const [info, details] = await Promise.all([readEventInfo(address).catch(() => null), readShowDetails(address)]);
      if (!info) return null;
      return {
        address,
        name: details?.name ?? "",
        venue: details?.venue ?? "",
        price: info.price,
        capacity: info.capacity,
        sold: info.sold,
        doorsOpen: info.doorsOpen,
        endTime: info.endTime,
        status: info.status,
      };
    }),
  );
  return rows.filter((r): r is ShowSummary => r !== null);
}

function withCatalogName(s: ShowSummary): ShowSummary {
  const meta = findEvent(s.address as Address);
  return meta && !s.name ? { ...s, name: meta.name, venue: s.venue || meta.venue } : s;
}
