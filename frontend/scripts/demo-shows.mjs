// Creates the extra demo shows listed under Shows: fictional names and venues, each signed by the demo organizer
// key (CreateShow), submitted by the relayer, then given a house-style poster and description. Prints the new
// addresses for DEMO_SHOWS in src/lib/events.ts. Run once.
//
//   BASE_URL=https://curtaintickets.vercel.app node scripts/demo-shows.mjs
import { readFileSync } from "node:fs";
import { sha256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { api, eventAbi, FACTORY, must, pub, RP_ID, USDC } from "./e2e-lib.mjs";
import { renderPoster, uploadPoster } from "./poster-lib.mjs";

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const organizer = privateKeyToAccount(env.match(/^ORGANIZER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1]);
const HOURS = 3600n;
// Doors-open times in Lagos (UTC+1).
const lagos = (iso) => BigInt(Math.floor(Date.parse(`${iso}+01:00`) / 1000));

const SHOWS = [
  {
    name: "Saturday Night Punchlines",
    venue: "The Ember Room, Yaba",
    doorsOpen: lagos("2026-10-17T20:00:00"),
    price: 1_000_000n, // ₦1,500
    poster: { line: "Six comics, one mic, and a door that pays them as you walk in.", when: "Sat 17 Oct · doors 8 pm" },
    description:
      "Six comics, one mic, two hours of stand-up. Your money is held until the show happens. When you walk in, it's paid to the comics at the door. If the show doesn't happen, it comes back to you automatically.",
  },
  {
    name: "Highlife After Dark",
    venue: "Lantern House, Lekki",
    doorsOpen: lagos("2026-10-24T19:00:00"),
    price: 2_000_000n, // ₦3,000
    poster: { line: "A seven-piece band and the old songs, played loud.", when: "Sat 24 Oct · doors 7 pm" },
    description:
      "A seven-piece band plays the highlife classics until late. Your money is held until the show happens. When you walk in, it's paid to the band at the door. If the show doesn't happen, it comes back to you automatically.",
  },
  {
    name: "First Draft: Open Mic Poetry",
    venue: "Copperleaf Studio, Surulere",
    doorsOpen: lagos("2026-10-31T18:00:00"),
    price: 1_000_000n, // ₦1,500
    poster: { line: "New poems, read out loud for the first time.", when: "Sat 31 Oct · doors 6 pm" },
    description:
      "Twelve poets read new work for the first time, with an open list at the end. Your money is held until the show happens. When you walk in, it's paid to the poets at the door. If the show doesn't happen, it comes back to you automatically.",
  },
];

const types = {
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
};

const created = [];
for (const s of SHOWS) {
  const endTime = s.doorsOpen + 6n * HOURS; // shows run six hours; tickets sell until the end
  const show = {
    payout: organizer.address, token: USDC, price: s.price, capacity: 150, salesEnd: endTime,
    doorsOpen: s.doorsOpen, endTime, settleDelay: HOURS, maxChallengeAge: 300, maxPerBuyer: 4,
    rpIdHash: sha256(toBytes(RP_ID)), gates: [],
  };
  const nonce = await pub.readContract({ address: FACTORY, abi: eventAbi, functionName: "nonces", args: [organizer.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const sig = await organizer.signTypedData({
    domain: { name: "CurtainFactory", version: "1", chainId: 10143, verifyingContract: FACTORY },
    types,
    primaryType: "CreateShow",
    message: { organizer: organizer.address, name: s.name, venue: s.venue, show, nonce, deadline },
  });
  const res = must(
    `create ${s.name}`,
    await api("/api/relay/create", { organizer: organizer.address, name: s.name, venue: s.venue, params: show, nonce, deadline, sig }),
  );
  console.log(`${s.name}: ${res.event} (tx ${res.hash})`);
  const png = await renderPoster({ kicker: "Demo show · Lagos", name: s.name, line: s.poster.line, when: s.poster.when, venue: s.venue });
  const media = await uploadPoster(res.event, organizer, png, s.description);
  console.log(`  poster: ${media.poster}`);
  created.push({ name: s.name, event: res.event, hash: res.hash });
}
console.log(JSON.stringify(created, null, 2));
