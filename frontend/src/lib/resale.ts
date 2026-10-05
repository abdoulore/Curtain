import type { Address, Hash, LocalAccount, TypedDataDefinition } from "viem";
import { curtainEventAbi } from "./abis";
import { postJson } from "./api";
import { CURTAIN_EIP712, listTypes, monadTestnet } from "./chain";
import type { TicketState } from "./reads";

export type Listing = { ticketId: bigint; price: bigint; seller: Address };

/** The exact typed data CurtainEvent verifies for a holder's listing. A zero price delists. */
export function listTypedData(event: Address, ticketId: bigint, price: bigint, nonce: bigint, deadline: bigint): TypedDataDefinition {
  return {
    domain: { ...CURTAIN_EIP712, chainId: monadTestnet.id, verifyingContract: event },
    types: listTypes,
    primaryType: "List",
    message: { ticketId, price, nonce, deadline },
  };
}

type Reader = {
  readContract: (args: never) => Promise<unknown>;
};

/** Signs a List at face value (or 0 to take it off sale) and has the relayer submit it. */
export async function listTicket(
  reader: Reader,
  event: Address,
  ticketId: bigint,
  price: bigint,
  signer: LocalAccount,
): Promise<{ hash: Hash; explorer: string }> {
  const nonce = (await reader.readContract({
    address: event,
    abi: curtainEventAbi,
    functionName: "nonces",
    args: [signer.address],
  } as never)) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
  const sig = await signer.signTypedData(listTypedData(event, ticketId, price, nonce, deadline));
  return postJson("/api/relay/list", { event, ticketId, price, nonce, deadline, sig });
}

/** Resale tickets someone else is selling, cheapest first. A buyer never sees their own listing. */
export function listingsFor(
  tickets: readonly { ticketId: bigint; state: TicketState; resalePrice: bigint; holder: Address }[],
  me: Address | undefined,
): Listing[] {
  return tickets
    .filter((t) => t.state === "Active" && t.resalePrice > 0n && t.holder.toLowerCase() !== me?.toLowerCase())
    .map((t) => ({ ticketId: t.ticketId, price: t.resalePrice, seller: t.holder }))
    .sort((a, b) => (a.price === b.price ? Number(a.ticketId - b.ticketId) : a.price < b.price ? -1 : 1));
}

export type CardStatus = "checking" | "ready" | "listed" | "used" | "refunded" | "refundOwed" | "sold" | "passedOn";

/**
 * What a ticket card says. A ticket that left this account after its owner listed it from here was sold;
 * otherwise it was passed on (a gift link or Send to my phone).
 */
export function cardStatus(
  info: { state: TicketState; holder: Address; resalePrice: bigint } | null,
  owner: Address,
  listedHere: boolean,
): CardStatus {
  if (!info) return "checking";
  if (info.holder.toLowerCase() !== owner.toLowerCase()) return listedHere ? "sold" : "passedOn";
  switch (info.state) {
    case "Active":
      return info.resalePrice > 0n ? "listed" : "ready";
    case "CheckedIn":
      return "used";
    case "Refunded":
      return "refunded";
    case "RefundOwed":
      return "refundOwed";
    default:
      return "checking";
  }
}

const LISTED_KEY = "curtain.listed.v1";

/** Remembers which tickets this device put on sale, so the card can say "Sold" once they go. */
export function rememberListed(event: Address, ticketId: string) {
  try {
    const all = new Set<string>(JSON.parse(localStorage.getItem(LISTED_KEY) ?? "[]"));
    all.add(`${event.toLowerCase()}-${ticketId}`);
    localStorage.setItem(LISTED_KEY, JSON.stringify([...all]));
  } catch {}
}

export function wasListedHere(event: Address, ticketId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(LISTED_KEY) ?? "[]") as string[]).includes(`${event.toLowerCase()}-${ticketId}`);
  } catch {
    return false;
  }
}
