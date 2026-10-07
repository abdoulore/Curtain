// Creates the demo shows, each signed by the demo organizer key (CreateShow) and submitted by the relayer: Curtain
// Demo Night, open now until the end of December so judges can buy and check in, and three more with fictional names
// and venues in December, each with a house-style poster. Prints the addresses for DEMO_EVENT in src/lib/chain.ts and
// DEMO_SHOWS in src/lib/events.ts. The demo show's poster and judge gate come from demo-setup.mjs.
//
//   BASE_URL=https://curtaintickets.vercel.app node scripts/demo-shows.mjs
//
// DIRECT=1 has the operator's relayer key submit the same organizer-signed CreateShow to the factory itself, for
// when the public create endpoint's daily per-network limit is used up. ONLY="Name,Name" creates just those shows.
import { readFileSync } from "node:fs";
import { createWalletClient, defineChain, http, parseEventLogs, sha256, toBytes } from "viem";
import { curtainFactoryAbi } from "../src/lib/abis.ts";
import { privateKeyToAccount } from "viem/accounts";
import { api, eventAbi, FACTORY, must, pub, RP_ID, USDC } from "./e2e-lib.mjs";
import { renderPoster, uploadPoster } from "./poster-lib.mjs";

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const key = (n) => env.match(new RegExp(`^${n}=(0x[0-9a-fA-F]{64})`, "m"))[1];
const organizer = privateKeyToAccount(key("ORGANIZER_PRIVATE_KEY"));
// The screenshot and test gate device; the public judge gate is paired by demo-setup.mjs.
const gateDevice = privateKeyToAccount(key("GATE_PRIVATE_KEY")).address;
const HOURS = 3600n;
// Times in Lagos (UTC+1).
const lagos = (iso) => BigInt(Math.floor(Date.parse(`${iso}+01:00`) / 1000));
const promise = () =>
  `Your money is held until the show happens. When you walk in, it's paid to the organizer at the door. If the show doesn't happen, it comes back to you automatically.`;

const SHOWS = [
  {
    name: "Curtain Demo Night",
    venue: "The Velvet Room, Victoria Island, Lagos",
    // Doors open now and stay open through judging.
    doorsOpen: BigInt(Math.floor(Date.now() / 1000)),
    endTime: lagos("2026-12-31T23:00:00"),
    price: 1_000_000n, // ₦1,500
    capacity: 200,
    gates: [gateDevice],
  },
  {
    name: "Saturday Night Punchlines",
    venue: "The Ember Room, Yaba",
    doorsOpen: lagos("2026-12-05T20:00:00"),
    price: 1_000_000n, // ₦1,500
    poster: { line: "Six comics, one mic, and a door that pays them as you walk in.", when: "Sat 5 Dec · doors 8 pm" },
    description: `Six comics, one mic, two hours of stand-up. ${promise()}`,
  },
  {
    name: "Highlife After Dark",
    venue: "Lantern House, Lekki",
    doorsOpen: lagos("2026-12-12T19:00:00"),
    price: 2_000_000n, // ₦3,000
    poster: { line: "A seven-piece band and the old songs, played loud.", when: "Sat 12 Dec · doors 7 pm" },
    description: `A seven-piece band plays the highlife classics until late. ${promise()}`,
  },
  {
    name: "First Draft: Open Mic Poetry",
    venue: "Copperleaf Studio, Surulere",
    doorsOpen: lagos("2026-12-19T18:00:00"),
    price: 1_000_000n, // ₦1,500
    poster: { line: "New poems, read out loud for the first time.", when: "Sat 19 Dec · doors 6 pm" },
    description: `Twelve poets read new work for the first time, with an open list at the end. ${promise()}`,
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

const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } });
const relayer = createWalletClient({ account: privateKeyToAccount(key("RELAYER_PRIVATE_KEY")), chain, transport: http() });

/** The organizer-signed CreateShow, submitted by the relayer key directly (estimate plus 10%, as the relayer does). */
async function createDirect(args) {
  const call = { address: FACTORY, abi: curtainFactoryAbi, functionName: "createEventFor", args, account: relayer.account };
  const estimate = await pub.estimateContractGas(call);
  const hash = await relayer.writeContract({ ...call, gas: estimate + estimate / 10n });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: curtainFactoryAbi, logs: receipt.logs, eventName: "EventCreated" });
  if (receipt.status !== "success" || !ev) throw new Error(`create failed: ${hash}`);
  return { event: ev.args.eventAddress, hash };
}

const only = process.env.ONLY?.split(",");
const created = [];
for (const s of SHOWS.filter((x) => !only || only.includes(x.name))) {
  const endTime = s.endTime ?? s.doorsOpen + 6n * HOURS; // shows run six hours unless set; tickets sell until the end
  const show = {
    payout: organizer.address, token: USDC, price: s.price, capacity: s.capacity ?? 150, salesEnd: endTime,
    doorsOpen: s.doorsOpen, endTime, settleDelay: HOURS, maxChallengeAge: 300, maxPerBuyer: 4,
    rpIdHash: sha256(toBytes(RP_ID)), gates: s.gates ?? [],
  };
  const nonce = await pub.readContract({ address: FACTORY, abi: eventAbi, functionName: "nonces", args: [organizer.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const sig = await organizer.signTypedData({
    domain: { name: "CurtainFactory", version: "1", chainId: 10143, verifyingContract: FACTORY },
    types,
    primaryType: "CreateShow",
    message: { organizer: organizer.address, name: s.name, venue: s.venue, show, nonce, deadline },
  });
  const res = process.env.DIRECT
    ? await createDirect([organizer.address, show, s.name, s.venue, nonce, deadline, sig])
    : must(
        `create ${s.name}`,
        await api("/api/relay/create", { organizer: organizer.address, name: s.name, venue: s.venue, params: show, nonce, deadline, sig }),
      );
  console.log(`${s.name}: ${res.event} (tx ${res.hash})`);
  if (s.poster) {
    const png = await renderPoster({ kicker: "Demo show · Lagos", name: s.name, line: s.poster.line, when: s.poster.when, venue: s.venue });
    const media = await uploadPoster(res.event, organizer, png, s.description);
    console.log(`  poster: ${media.poster}`);
  }
  created.push({ name: s.name, event: res.event, hash: res.hash });
}
console.log(JSON.stringify(created, null, 2));
