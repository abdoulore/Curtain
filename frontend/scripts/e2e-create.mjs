// End-to-end organizer flow on Monad testnet, with an EOA standing in for the organizer's passkey account (Mera
// accounts are plain EOAs, so the signatures are the same): create a show by signature, pair a gate device,
// sell and admit one ticket through that gate, then withdraw "₦1,500", which is one ticket's worth.
//
//   BASE_URL=http://localhost:3000 npm run e2e:create
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256, toBytes } from "viem";
import { api, buy, checkIn, eventAbi, FACTORY, must, organizerAction, person, pub, RP_ID, USDC, usdcOf } from "./e2e-lib.mjs";

const NAIRA_PER_USDC = 1500;
const organizer = privateKeyToAccount(generatePrivateKey());
console.log("organizer:", organizer.address);

// 1. Create the show: the organizer signs CreateShow, the relayer submits createEventFor.
const now = Math.floor(Date.now() / 1000);
const show = {
  payout: organizer.address, token: USDC, price: 1_000_000n, capacity: 50, salesEnd: BigInt(now + 6 * 3600),
  doorsOpen: BigInt(now), endTime: BigInt(now + 6 * 3600), settleDelay: 3600n, heldThresholdBps: 5000,
  maxChallengeAge: 300, maxPerBuyer: 4, rpIdHash: sha256(toBytes(RP_ID)), gates: [],
};
const name = "E2E Comedy Night";
const venue = "Terra Kulture, Victoria Island";
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
      { name: "endTime", type: "uint64" }, { name: "settleDelay", type: "uint64" }, { name: "heldThresholdBps", type: "uint16" },
      { name: "maxChallengeAge", type: "uint32" }, { name: "maxPerBuyer", type: "uint16" }, { name: "rpIdHash", type: "bytes32" },
      { name: "gates", type: "address[]" },
    ],
  },
  primaryType: "CreateShow",
  message: { organizer: organizer.address, name, venue, show, nonce, deadline },
});
const created = must("create show", await api("/api/relay/create", { organizer: organizer.address, name, venue, params: show, nonce, deadline, sig }));
const EVENT = created.event;
console.log("show:", EVENT);

// 2. Pair a gate: a new device key, registered by the organizer's signed SetGate.
const device = privateKeyToAccount(generatePrivateKey());
must("pair gate", await organizerAction(EVENT, organizer, "setGate", { gate: device.address, allowed: true }));
if (!(await pub.readContract({ address: EVENT, abi: eventAbi, functionName: "isGate", args: [device.address] }))) throw new Error("gate not paired");

// 3. A buyer comes through that gate.
const guest = person("guest");
must("guest top-up", await api("/api/topup", { address: guest.account.address }));
const ticketId = BigInt(must("guest buys", await buy(EVENT, guest, show.price)).ticketId);
must("guest checks in at the paired gate", await checkIn(EVENT, guest, ticketId, device));

// 4. Withdraw ₦1,500: one ticket's worth at the display rate.
const units = BigInt(Math.round((1500 / NAIRA_PER_USDC) * 1e6));
const before = await usdcOf(organizer.address);
must("withdraw ₦1,500", await organizerAction(EVENT, organizer, "withdraw", { amount: units }));
const got = (await usdcOf(organizer.address)) - before;
console.log(JSON.stringify({ withdrew: got.toString(), organizerMon: (await pub.getBalance({ address: organizer.address })).toString() }));
if (got !== 1_000_000n) throw new Error("withdrawal did not reach the payout");
console.log("PASS: show created by signature, gate paired, guest admitted through it, ₦1,500 withdrawn; the organizer never held MON");
