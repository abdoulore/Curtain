import { indexer } from "envio";
import { recordActivity, timestampOf } from "./shared";

// Every event is its own escrow clone; start indexing it as soon as the factory creates it.
indexer.contractRegister({ contract: "CurtainFactory", event: "EventCreated" }, async ({ event, context }) => {
  context.chain.CurtainEvent.add(event.params.eventAddress);
});

indexer.onEvent({ contract: "CurtainFactory", event: "EventCreated" }, async ({ event, context }) => {
  const show = event.params.eventAddress;
  const at = timestampOf(event);
  context.Show.set({
    id: show,
    organizer: event.params.organizer,
    name: "",
    venue: "",
    token: event.params.token,
    price: event.params.price,
    capacity: event.params.capacity,
    salesEnd: event.params.salesEnd,
    doorsOpen: event.params.doorsOpen,
    endTime: event.params.endTime,
    status: "Open",
    sold: 0,
    checkedIn: 0,
    refundedCount: 0,
    paidIn: 0n,
    escrowed: 0n,
    released: 0n,
    withdrawn: 0n,
    refunded: 0n,
    createdAt: at,
    updatedAt: at,
  });
  recordActivity(context.Activity, event, "Created", { show, account: event.params.organizer });
});

// Emitted right after EventCreated in the same transaction, for shows created with a name and venue.
indexer.onEvent({ contract: "CurtainFactory", event: "ShowDetails" }, async ({ event, context }) => {
  const show = await context.Show.getOrThrow(event.params.eventAddress, `Show ${event.params.eventAddress} missing`);
  context.Show.set({ ...show, name: event.params.name, venue: event.params.venue });
});
