import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");

/** The colour tokens in a block of CSS: `--name: #rrggbb;` */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const dark = { ...light, ...tokens(css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Text colours used for body text, links and status words, on each page background.
const TEXT = ["foreground", "muted", "velvet", "go", "stop"];
const GROUNDS = ["background", "surface"];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s mode contrast", (_, t) => {
  it.each(TEXT.flatMap((fg) => GROUNDS.map((bg) => [fg, bg])))("%s text on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps button text readable on velvet", () => {
    expect(contrast(t["velvet-ink"]!, t.velvet!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps white verdict text readable on ADMIT and DO NOT ADMIT", () => {
    expect(contrast("#ffffff", t.admit!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", t.deny!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("motion and focus", () => {
  it("shows a focus ring for keyboard users", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline: 2px solid/);
  });

  it("turns movement off for people who ask for reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important/);
  });
});
