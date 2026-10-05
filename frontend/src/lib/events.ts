import { getAddress, isAddress, type Address } from "viem";
import { DEMO_EVENT } from "./chain";

/** What the contract does not store: the words and place people see. */
export type EventMeta = {
  slug: string;
  address: Address;
  name: string;
  tagline: string;
  venue: string;
  city: string;
  isDemo: boolean;
};

const CATALOG: EventMeta[] = [
  {
    slug: "demo",
    address: DEMO_EVENT,
    name: "Curtain Demo Night",
    tagline: "Stand-up, live music and a door that pays the artists when you walk in.",
    venue: "The Velvet Room",
    city: "Victoria Island, Lagos",
    isDemo: true,
  },
];

export function findEvent(id: string): EventMeta | undefined {
  const bySlug = CATALOG.find((e) => e.slug === id);
  if (bySlug) return bySlug;
  if (!isAddress(id)) return undefined;
  const address = getAddress(id);
  return (
    CATALOG.find((e) => e.address === address) ?? {
      slug: address,
      address,
      name: "Curtain event",
      tagline: "Pay on entry. If the show doesn't happen, your money comes back.",
      venue: "Venue to be announced",
      city: "",
      isDemo: false,
    }
  );
}

export function eventPath(meta: Pick<EventMeta, "slug">): string {
  return `/e/${meta.slug}`;
}
