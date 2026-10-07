// Dresses the demo show: a poster and description signed by its organizer key, and a public judge gate (its
// pairing link goes in the README). Run once after deploying a new demo show.
//
//   BASE_URL=https://curtaintickets.vercel.app node scripts/demo-setup.mjs
import { readFileSync } from "node:fs";
import { concat, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { eventAbi, must, organizerAction, pub } from "./e2e-lib.mjs";
import { renderPoster, uploadPoster } from "./poster-lib.mjs";

const DEMO = "0x6385e193b18c4291Da556121e6E9eCF04b384672";
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const organizer = privateKeyToAccount(env.match(/^ORGANIZER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1]);

const png = await renderPoster({
  kicker: "Live in Lagos",
  name: "Curtain Demo Night",
  line: "Stand-up and live music. Held until the show happens, paid to the organizer at the door.",
  when: "Nightly · doors 7:30 pm",
  venue: "The Velvet Room, Victoria Island",
});
console.log(`poster: ${png.length} bytes`);
const meta = await uploadPoster(
  DEMO,
  organizer,
  png,
  "Stand-up and live music in Victoria Island. Your money is held until the show happens. When you walk in, it's paid to the organizer at the door. If the show doesn't happen, it comes back to you automatically.",
);
console.log("poster url:", meta.poster);

// POSTER_ONLY=1 re-uploads the poster and keeps the existing judge gate.
if (process.env.POSTER_ONLY) process.exit(0);
const key = generatePrivateKey();
const gate = privateKeyToAccount(key).address;
must("judge gate", await organizerAction(DEMO, organizer, "setGate", { gate, allowed: true }));
console.log("isGate:", await pub.readContract({ address: DEMO, abi: eventAbi, functionName: "isGate", args: [gate] }));
console.log("pairing:", `https://curtaintickets.vercel.app/gate/pair#${Buffer.from(hexToBytes(concat([DEMO, key]))).toString("base64url")}`);
