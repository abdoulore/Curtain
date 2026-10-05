import { indexer } from "envio";
import { recordActivity, ticketKey, timestampOf, updateShow } from "./shared";

// Money moves exactly as in CurtainEvent: buy escrows, check-in and a held settlement release, refunds return.

indexer.onEvent({ contract: "CurtainEvent", event: "Purchased" }, async ({ event, context }) => {
  const { ticketId, buyer, price } = event.params;
  await updateShow(context.Show, event, (s) => ({
    sold: s.sold + 1,
    paidIn: s.paidIn + price,
    escrowed: s.escrowed + price,
  }));
  context.Ticket.set({
    id: ticketKey(event.srcAddress, ticketId),
    show_id: event.srcAddress,
    ticketId,
    holder: buyer,
    state: "Active",
    price,
    resalePrice: 0n,
    boughtAt: timestampOf(event),
    boughtTx: event.transaction.hash,
    checkedInAt: undefined,
    checkedInTx: undefined,
  });
  recordActivity(context.Activity, event, "Purchased", { ticketId, account: buyer, amount: price });
});

indexer.onEvent({ contract: "CurtainEvent", event: "CheckedIn" }, async ({ event, context }) => {
  const { ticketId, gate, amount } = event.params;
  await updateShow(context.Show, event, (s) => ({
    checkedIn: s.checkedIn + 1,
    escrowed: s.escrowed - amount,
    released: s.released + amount,
  }));
  const id = ticketKey(event.srcAddress, ticketId);
  const ticket = await context.Ticket.getOrThrow(id);
  context.Ticket.set({
    ...ticket,
    state: "CheckedIn",
    resalePrice: 0n,
    checkedInAt: timestampOf(event),
    checkedInTx: event.transaction.hash,
  });
  recordActivity(context.Activity, event, "CheckedIn", { ticketId, account: gate, amount });
});

indexer.onEvent({ contract: "CurtainEvent", event: "Withdrawn" }, async ({ event, context }) => {
  const { to, amount } = event.params;
  await updateShow(context.Show, event, (s) => ({ withdrawn: s.withdrawn + amount }));
  recordActivity(context.Activity, event, "Withdrawn", { account: to, amount });
});

indexer.onEvent({ contract: "CurtainEvent", event: "Cancelled" }, async ({ event, context }) => {
  await updateShow(context.Show, event, () => ({ status: "Cancelled" }));
  recordActivity(context.Activity, event, "Cancelled");
});

indexer.onEvent({ contract: "CurtainEvent", event: "Settled" }, async ({ event, context }) => {
  const { held, releasedAmount } = event.params;
  await updateShow(context.Show, event, (s) =>
    held
      ? { status: "Held", escrowed: s.escrowed - releasedAmount, released: s.released + releasedAmount }
      : { status: "NotHeld" },
  );
  recordActivity(context.Activity, event, "Settled", { amount: releasedAmount });
});

indexer.onEvent({ contract: "CurtainEvent", event: "Refunded" }, async ({ event, context }) => {
  const { ticketId, holder, amount } = event.params;
  await updateShow(context.Show, event, (s) => ({
    refundedCount: s.refundedCount + 1,
    escrowed: s.escrowed - amount,
    refunded: s.refunded + amount,
  }));
  const ticket = await context.Ticket.getOrThrow(ticketKey(event.srcAddress, ticketId));
  context.Ticket.set({ ...ticket, state: "Refunded", resalePrice: 0n });
  recordActivity(context.Activity, event, "Refunded", { ticketId, account: holder, amount });
});

indexer.onEvent({ contract: "CurtainEvent", event: "RefundOwed" }, async ({ event, context }) => {
  const { ticketId, holder, amount } = event.params;
  const ticket = await context.Ticket.getOrThrow(ticketKey(event.srcAddress, ticketId));
  context.Ticket.set({ ...ticket, state: "RefundOwed" });
  recordActivity(context.Activity, event, "RefundOwed", { ticketId, account: holder, amount });
});

indexer.onEvent({ contract: "CurtainEvent", event: "Listed" }, async ({ event, context }) => {
  const { ticketId, price } = event.params;
  const ticket = await context.Ticket.getOrThrow(ticketKey(event.srcAddress, ticketId));
  context.Ticket.set({ ...ticket, resalePrice: price });
  recordActivity(context.Activity, event, "Listed", { ticketId, account: ticket.holder, amount: price });
});

indexer.onEvent({ contract: "CurtainEvent", event: "Resold" }, async ({ event, context }) => {
  const { ticketId, seller, buyer, price } = event.params;
  const ticket = await context.Ticket.getOrThrow(ticketKey(event.srcAddress, ticketId));
  context.Ticket.set({ ...ticket, holder: buyer, resalePrice: 0n });
  recordActivity(context.Activity, event, "Resold", { ticketId, account: seller, amount: price });
});

indexer.onEvent({ contract: "CurtainEvent", event: "ClaimSet" }, async ({ event, context }) => {
  const { ticketId, claimKey } = event.params;
  recordActivity(context.Activity, event, "ClaimSet", { ticketId, account: claimKey });
});

indexer.onEvent({ contract: "CurtainEvent", event: "Claimed" }, async ({ event, context }) => {
  const { ticketId, to } = event.params;
  const ticket = await context.Ticket.getOrThrow(ticketKey(event.srcAddress, ticketId));
  context.Ticket.set({ ...ticket, holder: to, resalePrice: 0n });
  recordActivity(context.Activity, event, "Claimed", { ticketId, account: to });
});

// Gate devices paired (or removed) by the organizer. Gates set at creation are logged before the factory's
// EventCreated, so the dashboard also checks isGate on chain.
indexer.onEvent({ contract: "CurtainEvent", event: "GateSet" }, async ({ event, context }) => {
  const show = event.srcAddress;
  context.Gate.set({
    id: `${show}-${event.params.gate}`,
    show_id: show,
    gate: event.params.gate,
    allowed: event.params.allowed,
    updatedAt: timestampOf(event),
  });
});
