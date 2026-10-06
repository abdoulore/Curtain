// Renders a show poster PNG from scripts/poster.html and uploads it, with a description, the way the create page
// does: the organizer signs the show address plus the file and text hashes, the server checks it's the organizer.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256, toBytes } from "viem";
import { chromium } from "playwright";
import { BASE_URL } from "./e2e-lib.mjs";

export async function renderPoster(fields) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  const url = pathToFileURL(fileURLToPath(new URL("poster.html", import.meta.url)));
  url.search = new URLSearchParams(fields).toString();
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });
  await browser.close();
  return new Uint8Array(png);
}

export async function uploadPoster(event, organizer, png, description) {
  const message = [
    "Curtain show details",
    `Show: ${event}`,
    `Poster: ${sha256(png)}`,
    `Description: ${sha256(toBytes(description))}`,
  ].join("\n");
  const sig = await organizer.signMessage({ message });
  const form = new FormData();
  form.set("poster", new Blob([png], { type: "image/png" }), "poster.png");
  form.set("description", description);
  form.set("sig", sig);
  const res = await fetch(`${BASE_URL}/api/shows/${event}/media`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`poster upload failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

export const readPng = (path) => new Uint8Array(readFileSync(path));
