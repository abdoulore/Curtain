import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUYER_PROMISE, ORGANIZER_PROMISE, PASSKEY_PRIVACY } from "./copy";

const SRC = join(__dirname, "..");

/** Every UI source file: components, pages and libraries, without tests or server routes. */
function uiFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return d.name === "api" ? [] : uiFiles(path);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [path] : [];
  });
}

/** Source without comments, so only what a person can read on screen is checked. */
function visibleText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

// Claims the contract doesn't make, or words from before the shared vocabulary.
const BANNED = [
  "until you walk in",
  "only when you walk in",
  "held safely",
  "stays safe",
  "show's safe",
  "released to the organizer",
  "money released",
  "settled as held",
  "released as people",
];

describe("copy", () => {
  const files = uiFiles();

  it("finds the UI sources", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(BANNED)("never says %s", (phrase) => {
    const hits = files.filter((f) => visibleText(readFileSync(f, "utf8")).toLowerCase().includes(phrase));
    expect(hits).toEqual([]);
  });

  it("has no em dashes anywhere in the source", () => {
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("—"));
    expect(hits).toEqual([]);
  });

  it("keeps the promises consistent with the contract", () => {
    expect(BUYER_PROMISE).toContain("held until the show happens");
    expect(ORGANIZER_PROMISE).toContain("refunded automatically");
    expect(PASSKEY_PRIVACY).toContain("never leaves your phone");
  });
});
