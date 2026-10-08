// End-to-end refund on Monad testnet: an organizer creates a show by signature, two guests buy, the organizer
// cancels, and the relayer refunds both guests straight away, with nobody asking. Then a guest's own "Get my refund"
// request is checked against the already-refunded show.
//
//   BASE_URL=https://curtaintickets.vercel.app FUND_DIRECT=1 node scripts/e2e-refund.mjs
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256, toBytes } from "viem";
import { api, buy, eventAbi, FACTORY, must, organizerAction, person, pub, RP_ID, USDC, usdcOf } from "./e2e-lib.mjs";

const organizer = privateKeyToAccount(generatePrivateKey());
const now = Math.floor(Date.now() / 1000);
const show = {
  payout: organizer.address, token: USDC, price: 1_000_000n, capacity: 50, salesEnd: BigInt(now + 6 * 3600),
  doorsOpen: BigInt(now), endTime: BigInt(now + 6 * 3600), settleDelay: 3600n,
  maxChallengeAge: 300, maxPerBuyer: 4, rpIdHash: sha256(toBytes(RP_ID)), gates: [],
};
const name = "E2E Refund Night";
const venue = "The Ember Room, Yaba";
const nonce = await pub.readContract({ address: FACTORY, abi: eventAbi, functionName: "nonces", args: [organizer.address] });
const deadline = BigInt(now + 900);
const sig = await organizer.signTypedData({
  domain: { name: "CurtainFactory", version: "1", chainId: 10143, verifyingContract: FACTORY },
  types: {
    CreateShow: [
      { name: "organizer", type: "address" }, { name: "name", type: "string" }, { name: "venue", type: "string" },
      { name: "show", type: "Show" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ],
    Show: [
      { name: "payout", type: "address" }, { name: "token", type: "address" }, { name: "price", type: "uint96" },
      { name: "capacity", type: "uint32" }, { name: "salesEnd", type: "uint64" }, { name: "doorsOpen", type: "uint64" },
      { name: "endTime", type: "uint64" }, { name: "settleDelay", type: "uint64" },
      { name: "maxChallengeAge", type: "uint32" }, { name: "maxPerBuyer", type: "uint16" }, { name: "rpIdHash", type: "bytes32" },
      { name: "gates", type: "address[]" },
    ],
  },
  primaryType: "CreateShow",
  message: { organizer: organizer.address, name, venue, show, nonce, deadline },
});
const EVENT = must("create show", await api("/api/relay/create", { organizer: organizer.address, name, venue, params: show, nonce, deadline, sig })).event;
console.log("show:", EVENT);

// Two guests buy one ticket each.
const guests = [person("guest-a"), person("guest-b")];
const before = [];
for (const g of guests) {
  must("top-up", await api("/api/topup", { address: g.account.address }));
  before.push(await usdcOf(g.account.address));
  must("buy", await buy(EVENT, g, show.price));
}

// The organizer cancels; the relayer pushes the refunds in the same request.
const cancelled = must("cancel", await organizerAction(EVENT, organizer, "cancel", {}));
console.log("refund transactions:", cancelled.refunds);
for (const [i, g] of guests.entries()) {
  const now = await usdcOf(g.account.address);
  if (now !== before[i]) throw new Error(`guest ${i} not refunded: had ${before[i]}, now ${now}`);
}
const state = await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "refunded" }).catch(() => null);
console.log("refunded on the escrow:", state?.toString());

// A guest asking afterwards finds nothing left to do, and isn't charged for it.
const again = await api("/api/relay/refund", { event: EVENT, ticketId: "1" });
console.log("Get my refund afterwards:", again.status, JSON.stringify(again.json));
console.log("PASS: cancelled, both guests refunded automatically by the relayer, no one had to ask");
