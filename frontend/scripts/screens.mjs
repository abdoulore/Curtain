// Screenshots of every page at phone (375px) and desktop (1440px) widths, saved to docs/screens.
//
//   BASE_URL=https://curtaintickets.vercel.app npm run screens     (gate code from .env.local, never shown on screen)
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "https://curtaintickets.vercel.app";
const OUT = new URL("../../docs/screens/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const gateCode =
  process.env.GATE_ACCESS_CODE ??
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^GATE_ACCESS_CODE=(.*)$/m)?.[1]?.trim();

const fragment = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const EVENT = "0xd3F22B52F74D658318C29E0475E1833214eCA005";
// Packed like the gate QR: event (20) + nonce (32) + block (8) + expiry (4) + tag (32) bytes.
const packed = EVENT.slice(2) + "ab".repeat(32) + "0000000004130000" + "f4865700" + "cd".repeat(32);
const sampleGate = Buffer.from(packed, "hex").toString("base64url");
const sampleClaim = fragment({ e: EVENT, t: "1", k: `0x${"12".repeat(32)}` });

const pages = [
  { name: "home", path: "/" },
  { name: "event", path: "/e/demo" },
  { name: "tickets", path: "/tickets" },
  { name: "checkin", path: `/checkin#${sampleGate}` },
  { name: "claim", path: `/claim#${sampleClaim}` },
  { name: "board", path: "/board/demo" },
  { name: "gate", path: "/gate/demo", gate: true },
  { name: "organizer", path: "/organizer/demo" },
];
const viewports = [
  { label: "375", width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { label: "1440", width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

const browser = await chromium.launch();
for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
    colorScheme: "light",
  });
  for (const p of pages) {
    const page = await context.newPage();
    if (p.gate && gateCode) await page.addInitScript((code) => localStorage.setItem("curtain.gateCode.v1", code), gateCode);
    await page.goto(`${BASE_URL}${p.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500); // chain reads and the gate's first code
    // Wider content than the viewport, measured on the body too (fieldsets and wide rows can escape the root check).
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth);
    const file = new URL(`${p.name}-${vp.label}.png`, OUT);
    await page.screenshot({ path: fileURLToPath(file), fullPage: true });
    console.log(`${p.name}-${vp.label}.png${overflow ? "  HORIZONTAL OVERFLOW" : ""}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
