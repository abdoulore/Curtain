// Screenshots of every page at phone (375px) and desktop (1440px) widths, saved to docs/screens.
// Signed-in states are seeded into localStorage from real testnet state (see screens-setup.mjs); nothing is mocked
// onchain. The pairing dialog is reached through the dashboard's wallet fallback, backed here by the demo show's
// organizer key, so taking it sends one real SetGate per width, and one more to remove that gate again.
//
//   BASE_URL=https://curtaintickets.vercel.app npm run screens
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { concat, hexToBytes, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { organizerAction } from "./e2e-lib.mjs";
import { issueGatePass } from "./gate-device.mjs";

const BASE_URL = process.env.BASE_URL ?? "https://curtaintickets.vercel.app";
const OUT = new URL("../../docs/screens/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const keyFromEnv = (name) => env.match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})`, "m"))?.[1];
const organizer = privateKeyToAccount(keyFromEnv("ORGANIZER_PRIVATE_KEY"));
const gateKey = keyFromEnv("GATE_PRIVATE_KEY");
const state = JSON.parse(readFileSync(new URL("state.json", OUT), "utf8"));

const DEMO = "0x5562bF1ccBabcF2f060239f9D241Ba9661217135";
const b64url = (hex) => Buffer.from(hexToBytes(hex)).toString("base64url");
const gate = await issueGatePass(DEMO);
const sampleGate = b64url(concat([DEMO, gate.gateNonce, toHex(BigInt(gate.challengeBlock), { size: 8 }), gate.pass]));
const sampleClaim = Buffer.from(JSON.stringify({ e: DEMO, t: "4", k: `0x${"12".repeat(32)}` })).toString("base64url");
const unpairedTablet = b64url(concat([DEMO, generatePrivateKey()]));

const account = (address, name) => ({ address, credentialId: "screenshot", name, createdAt: 1_791_000_000_000 });
const seeds = {
  persona: {
    "curtain.account.v1": account(state.persona, "Ada"),
    "curtain.tickets.v1": state.tickets.map((t, i) => ({
      event: t.event,
      ticketId: t.ticketId,
      owner: state.persona,
      hash: "0x",
      boughtAt: 1_791_200_000_000 + i,
    })),
    "curtain.listed.v1": state.tickets.filter((t) => t.listedHere).map((t) => `${t.event.toLowerCase()}-${t.ticketId}`),
  },
  organizer: {
    "curtain.account.v1": account(organizer.address, "Ore"),
    "curtain.myShows.v1": [{ event: DEMO, organizer: organizer.address, name: "Curtain Demo Night", hash: "0x", at: 0 }],
  },
  gate: { [`curtain.gateDevice.v1.${DEMO.toLowerCase()}`]: gateKey },
};

const pages = [
  { name: "home", path: "/" },
  { name: "event", path: "/e/demo" },
  { name: "tickets", path: "/tickets", seed: "persona" },
  { name: "checkin", path: `/checkin#${sampleGate}` },
  { name: "claim", path: `/claim#${sampleClaim}` },
  { name: "board", path: "/board/demo" },
  { name: "gate", path: "/gate/demo", seed: "gate" },
  { name: "gate-pair", path: `/gate/pair#${unpairedTablet}` },
  { name: "organizer-shows", path: "/organizer", seed: "organizer" },
  { name: "organizer-new", path: "/organizer/new", seed: "organizer" },
  { name: "organizer", path: "/organizer/demo", seed: "organizer" },
  { name: "organizer-pairing", path: "/organizer/demo", seed: "organizer", pair: true },
  // A real purchase with a virtual passkey authenticator (with PRF), ending on the success screen.
  { name: "bought", path: "/e/demo", buy: true },
];
const viewports = [
  { label: "375", width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { label: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

/** A minimal EIP-1193 wallet holding the demo show's organizer key, for the dashboard's hidden wallet fallback. */
async function installWallet(page) {
  await page.exposeFunction("__curtainSign", async (json) => organizer.signTypedData(JSON.parse(json, (_, v) => v)));
  await page.addInitScript((address) => {
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0x279f";
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        if (method === "eth_signTypedData_v4") return window.__curtainSign(params[1]);
        throw new Error(`unsupported ${method}`);
      },
      on() {},
      removeListener() {},
    };
  }, organizer.address);
}

const browser = await chromium.launch();
for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
    colorScheme: "light",
  });
  // ONLY=organizer,board retakes just those pages.
  const only = process.env.ONLY?.split(",");
  for (const p of pages.filter((x) => !only || only.includes(x.name))) {
    const page = await context.newPage();
    const seed = p.seed ? seeds[p.seed] : {};
    await page.addInitScript((entries) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }, seed);
    if (p.pair) await installWallet(page);
    if (p.buy) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
          hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true,
        },
      });
    }
    await page.goto(`${BASE_URL}${p.path}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(3000); // chain reads and the gate's first code
    // Wait out any card or total still loading from the public RPC.
    await page.waitForFunction(() => !/Checking…|…/.test(document.body.innerText), null, { timeout: 20_000 }).catch(() => {});
    if (p.buy) {
      await page.getByPlaceholder("Ada").fill("Ngozi");
      await page.getByRole("button", { name: "Get my ticket" }).click();
      const done = await page.getByText("You're in.").waitFor({ timeout: 120_000 }).then(() => true, () => false);
      if (!done) throw new Error(`purchase did not finish: ${await page.locator(".text-stop").allInnerTexts()}`);
      await page.getByText("You're in.").scrollIntoViewIfNeeded();
    }
    if (p.pair) {
      await page.getByText("Use a browser wallet instead").click();
      await page.getByRole("button", { name: "Connect a wallet" }).click();
      await page.getByRole("button", { name: "Add a gate device" }).click();
      const opened = await page.getByRole("dialog").waitFor({ timeout: 60_000 }).then(() => true, () => false);
      if (!opened) throw new Error(`pairing failed: ${await page.locator("p.text-stop").allInnerTexts()}`);
      await page.waitForTimeout(500);
    }
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth);
    const file = new URL(`${p.name}-${vp.label}.png`, OUT);
    await page.screenshot({ path: fileURLToPath(file), fullPage: !p.pair });
    console.log(`${p.name}-${vp.label}.png${overflow ? "  HORIZONTAL OVERFLOW" : ""}`);
    if (p.pair) {
      // Unpair the throwaway gate the dialog registered, so the demo show keeps only its real gate.
      const paired = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), `curtain.pairedGates.v1.${DEMO.toLowerCase()}`);
      for (const gate of paired) await organizerAction(DEMO, organizer, "setGate", { gate, allowed: false });
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
