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

/** Events this app lists. */
export const CATALOG_EVENTS: readonly Address[] = CATALOG.map((e) => e.address);

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
      // Shows made on the create page carry their own name and venue onchain; see withDetails.
      city: "",
      isDemo: false,
    }
  );
}

/** Applies the name and venue an organizer gave a show onchain. Catalog entries keep their own copy. */
export function withDetails(meta: EventMeta, details: { name: string; venue: string } | undefined): EventMeta {
  if (!details?.name || CATALOG.some((e) => e.address === meta.address)) return meta;
  return { ...meta, name: details.name, venue: details.venue || meta.venue, city: "" };
}

export function eventPath(meta: Pick<EventMeta, "slug">): string {
  return `/e/${meta.slug}`;
}
