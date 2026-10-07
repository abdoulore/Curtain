import { describe, it } from "vitest";
import { createTestIndexer, TestHelpers } from "envio";

const { Addresses } = TestHelpers;
type Hex = `0x${string}`;
const lower = (a: string) => a.toLowerCase() as Hex;
const CHAIN = 10143;
const SHOW = lower(Addresses.mockAddresses[0]!);
const ORGANIZER = lower(Addresses.mockAddresses[1]!);
const ALICE = lower(Addresses.mockAddresses[2]!);
const BOB = lower(Addresses.mockAddresses[3]!);
const CAROL = lower(Addresses.mockAddresses[4]!);
const GATE = lower(Addresses.mockAddresses[5]!);
const USDC = lower(Addresses.mockAddresses[6]!);
const PRICE = 1_000_000n;
const KEY = `0x${"11".repeat(32)}` as Hex;

let seq = 0;
/** Each simulated log gets its own block, tx and log index so activity ids stay unique. */
function at<T extends object>(item: T) {
  seq += 1;
  return {
    ...item,
    block: { number: 69_000_000 + seq, timestamp: 1_791_200_000 + seq }, // after config.yaml start_block
    transaction: { hash: `0x${seq.toString(16).padStart(64, "0")}` as Hex },
    logIndex: 0,
  };
}

const created = () =>
  at({
    contract: "CurtainFactory" as const,
    event: "EventCreated" as const,
    params: {
      eventAddress: SHOW,
      organizer: ORGANIZER,
      token: USDC,
      price: PRICE,
      capacity: 10n,
      salesEnd: 2_000_000_000n,
      doorsOpen: 1_791_000_000n,
      endTime: 2_000_000_000n,
      rpIdHash: KEY,
    },
  });

const purchased = (ticketId: bigint, buyer: Hex) =>
  at({
    contract: "CurtainEvent" as const,
    event: "Purchased" as const,
    srcAddress: SHOW,
    params: { ticketId, buyer, qx: KEY, qy: KEY, price: PRICE },
  });

describe("Curtain indexer", () => {
  it("tracks a show from sales through check-in, withdrawal, cancellation and refunds", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            created(),
            purchased(1n, ALICE),
            purchased(2n, BOB),
            purchased(3n, CAROL),
            at({
              contract: "CurtainEvent",
              event: "CheckedIn",
              srcAddress: SHOW,
              params: { ticketId: 1n, gate: GATE, challenge: KEY, amount: PRICE },
            }),
            at({ contract: "CurtainEvent", event: "Withdrawn", srcAddress: SHOW, params: { to: ORGANIZER, amount: PRICE } }),
            at({ contract: "CurtainEvent", event: "Cancelled", srcAddress: SHOW }),
            at({
              contract: "CurtainEvent",
              event: "Refunded",
              srcAddress: SHOW,
              params: { ticketId: 2n, holder: BOB, amount: PRICE },
            }),
            at({
              contract: "CurtainEvent",
              event: "RefundOwed",
              srcAddress: SHOW,
              params: { ticketId: 3n, holder: CAROL, amount: PRICE },
            }),
          ],
        },
      },
    });

    const show = await indexer.Show.getOrThrow(SHOW);
    t.expect({
      status: show.status,
      sold: show.sold,
      checkedIn: show.checkedIn,
      refundedCount: show.refundedCount,
      paidIn: show.paidIn,
      escrowed: show.escrowed,
      released: show.released,
      withdrawn: show.withdrawn,
      refunded: show.refunded,
    }).toEqual({
      status: "Cancelled",
      sold: 3,
      checkedIn: 1,
      refundedCount: 1,
      paidIn: 3n * PRICE,
      escrowed: PRICE, // carol's refund is still owed
      released: PRICE,
      withdrawn: PRICE,
      refunded: PRICE,
    });
    t.expect(show.paidIn, "paid in equals escrowed plus released plus refunded").toBe(
      show.escrowed + show.released + show.refunded,
    );

    const states = await Promise.all(
      [1n, 2n, 3n].map(async (id) => (await indexer.Ticket.getOrThrow(`${SHOW}-${id}`)).state),
    );
    t.expect(states).toEqual(["CheckedIn", "Refunded", "RefundOwed"]);

    const activity = await indexer.Activity.getAll();
    t.expect(activity.map((a) => a.kind).sort()).toEqual(
      ["Created", "Purchased", "Purchased", "Purchased", "CheckedIn", "Withdrawn", "Cancelled", "Refunded", "RefundOwed"].sort(),
    );
    t.expect(indexer.chains[CHAIN].CurtainEvent.addresses.map((a) => a.toLowerCase())).toContain(SHOW);
  });

  it("releases unscanned money when a show settles as held, and rebinds holders on resale and gift claims", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            created(),
            purchased(1n, ALICE),
            purchased(2n, BOB),
            at({ contract: "CurtainEvent", event: "Listed", srcAddress: SHOW, params: { ticketId: 1n, price: PRICE } }),
            at({
              contract: "CurtainEvent",
              event: "Resold",
              srcAddress: SHOW,
              params: { ticketId: 1n, seller: ALICE, buyer: CAROL, price: PRICE },
            }),
            at({ contract: "CurtainEvent", event: "Claimed", srcAddress: SHOW, params: { ticketId: 2n, from: BOB, to: ALICE } }),
            at({
              contract: "CurtainEvent",
              event: "CheckedIn",
              srcAddress: SHOW,
              params: { ticketId: 1n, gate: GATE, challenge: KEY, amount: PRICE },
            }),
            at({ contract: "CurtainEvent", event: "Settled", srcAddress: SHOW, params: { held: true, releasedAmount: PRICE } }),
          ],
        },
      },
    });

    const show = await indexer.Show.getOrThrow(SHOW);
    t.expect({ status: show.status, escrowed: show.escrowed, released: show.released }).toEqual({
      status: "Held",
      escrowed: 0n,
      released: 2n * PRICE,
    });
    const [one, two] = await Promise.all([
      indexer.Ticket.getOrThrow(`${SHOW}-1`),
      indexer.Ticket.getOrThrow(`${SHOW}-2`),
    ]);
    t.expect([one.holder, one.resalePrice, one.state]).toEqual([CAROL, 0n, "CheckedIn"]);
    t.expect([two.holder, two.state]).toEqual([ALICE, "Active"]);
  });

  it("names a show from ShowDetails and tracks paired gates", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            created(),
            at({
              contract: "CurtainFactory",
              event: "ShowDetails",
              params: { eventAddress: SHOW, name: "Lagos Laughs", venue: "Terra Kulture" },
            }),
            at({ contract: "CurtainEvent", event: "GateSet", srcAddress: SHOW, params: { gate: GATE, allowed: true } }),
            at({ contract: "CurtainEvent", event: "GateSet", srcAddress: SHOW, params: { gate: ALICE, allowed: true } }),
            at({ contract: "CurtainEvent", event: "GateSet", srcAddress: SHOW, params: { gate: ALICE, allowed: false } }),
          ],
        },
      },
    });

    const show = await indexer.Show.getOrThrow(SHOW);
    t.expect([show.name, show.venue, show.organizer]).toEqual(["Lagos Laughs", "Terra Kulture", ORGANIZER]);
    const [gate, removed] = await Promise.all([
      indexer.Gate.getOrThrow(`${SHOW}-${GATE}`),
      indexer.Gate.getOrThrow(`${SHOW}-${ALICE}`),
    ]);
    t.expect([gate.allowed, removed.allowed]).toEqual([true, false]);
  });
});
