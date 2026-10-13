// Dresses the demo show: a poster and description signed by its organizer key, and a public judge gate (its
// pairing link goes in the README). Run once after deploying a new demo show.
//
//   BASE_URL=https://curtaintickets.vercel.app node scripts/demo-setup.mjs
import { readFileSync } from "node:fs";
import { concat, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { eventAbi, must, organizerAction, pub } from "./e2e-lib.mjs";
import { readPng, renderPoster, uploadPoster } from "./poster-lib.mjs";

const DEMO = "0xfF2D205A82798C1cFB267670c05bcd98c27fa08C";
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const organizer = privateKeyToAccount(env.match(/^ORGANIZER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1]);

// POSTER_FILE=path uploads that PNG or JPEG; otherwise a house-style poster is drawn.
const png = process.env.POSTER_FILE
  ? readPng(process.env.POSTER_FILE)
  : await renderPoster({
      kicker: "Live in Lagos",
      name: "The Last Danfo",
      line: "A stage comedy about the last yellow bus in Lagos.",
      when: "Nightly · 7:30 pm",
      venue: "The Brickhall Theatre, Ikoyi",
    });
console.log(`poster: ${png.length} bytes`);
const meta = await uploadPoster(
  DEMO,
  organizer,
  png,
  "The last yellow danfo in Lagos is being taken off the road, and nine passengers refuse to get off. A stage comedy " +
    "about traffic, family and one very stubborn conductor. Nightly at 7:30 pm, about 90 minutes. " +
    "Your money is held until the show happens. When you walk in, it's paid to the organizer at the door. If the show " +
    "doesn't happen, it comes back to you automatically.",
  process.env.POSTER_FILE?.endsWith(".jpg") ? "image/jpeg" : "image/png",
);
console.log("poster url:", meta.poster);

// POSTER_ONLY=1 re-uploads the poster and keeps the existing judge gate.
if (process.env.POSTER_ONLY) process.exit(0);
const key = generatePrivateKey();
const gate = privateKeyToAccount(key).address;
must("judge gate", await organizerAction(DEMO, organizer, "setGate", { gate, allowed: true }));
console.log("isGate:", await pub.readContract({ address: DEMO, abi: eventAbi, functionName: "isGate", args: [gate] }));
console.log("pairing:", `https://curtaintickets.vercel.app/gate/pair#${Buffer.from(hexToBytes(concat([DEMO, key]))).toString("base64url")}`);
