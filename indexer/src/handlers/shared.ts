import type { Activity, Show } from "envio";

/** The parts of an Envio event these helpers read. */
type EventMeta = {
  srcAddress: string;
  logIndex: number;
  block: { timestamp: number };
  transaction: { hash: string };
};

type ShowStore = { getOrThrow: (id: string, message?: string) => Promise<Show>; set: (s: Show) => void };
type ActivityStore = { set: (a: Activity) => void };

export const ticketKey = (show: string, ticketId: bigint) => `${show}-${ticketId}`;
export const timestampOf = (event: EventMeta) => BigInt(event.block.timestamp);

/** Applies a change to a show's totals and stamps when it happened. */
export async function updateShow(store: ShowStore, event: EventMeta, change: (show: Show) => Partial<Show>) {
  const show = await store.getOrThrow(event.srcAddress, `Show ${event.srcAddress} was not created by the factory`);
  store.set({ ...show, ...change(show), updatedAt: timestampOf(event) });
}

export function recordActivity(
  store: ActivityStore,
  event: EventMeta,
  kind: Activity["kind"],
  fields: { show?: string; ticketId?: bigint; account?: string; amount?: bigint } = {},
) {
  store.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    show_id: fields.show ?? event.srcAddress,
    kind,
    ticketId: fields.ticketId,
    account: fields.account,
    amount: fields.amount ?? 0n,
    timestamp: timestampOf(event),
    txHash: event.transaction.hash,
  });
}
