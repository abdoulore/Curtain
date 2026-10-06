import { getAddress, getContractAddress, type Address } from "viem";

export type ShowSummary = {
  address: Address;
  name: string;
  venue: string;
  price: bigint;
  capacity: number;
  sold: number;
  doorsOpen: number;
  endTime: number;
  status: string;
};

/**
 * Shows people can still buy for: open, not over, not sold out. The demo show comes first, then the soonest.
 */
export function upcomingShows(shows: readonly ShowSummary[], now: number, pinned: Address): ShowSummary[] {
  const pin = getAddress(pinned);
  return shows
    .filter((s) => s.status === "Open" && s.endTime > now && s.sold < s.capacity)
    .sort((a, b) => {
      if (getAddress(a.address) === pin) return -1;
      if (getAddress(b.address) === pin) return 1;
      return a.doorsOpen - b.doorsOpen || a.address.localeCompare(b.address);
    });
}

/**
 * Every show a factory created, newest first, without an indexer. The factory deploys each clone with CREATE, so
 * clone addresses follow from its nonce; nonce 1 deployed the implementation.
 */
export function factoryShowAddresses(factory: Address, factoryNonce: number, max: number): Address[] {
  const out: Address[] = [];
  for (let n = factoryNonce - 1; n >= 2 && out.length < max; n--) {
    out.push(getContractAddress({ from: factory, nonce: BigInt(n) }));
  }
  return out;
}
