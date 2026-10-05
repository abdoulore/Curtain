/**
 * Buyers see naira. Tickets settle in USDC (6 decimals) at this displayed rate.
 * Testnet demo rate; a live app would quote it from an on-ramp partner.
 */
export const NAIRA_PER_USDC = 1500;

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

/** USDC base units (6 decimals) to a naira string, e.g. 1_000_000n -> "₦1,500". */
export function formatNaira(usdcUnits: bigint): string {
  return naira.format((Number(usdcUnits) / 1e6) * NAIRA_PER_USDC);
}

/**
 * A naira amount typed by a person to USDC base units at the display rate, e.g. "1500" -> 1_000_000n.
 * Accepts commas and a leading naira sign. Returns null for anything that is not a positive amount.
 */
export function nairaToUsdcUnits(input: string): bigint | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const units = BigInt(Math.round((Number(cleaned) / NAIRA_PER_USDC) * 1e6));
  return units > 0n ? units : null;
}

/** USDC base units to a whole-naira number for form fields, e.g. 1_000_000n -> 1500. */
export function usdcUnitsToNaira(units: bigint): number {
  return Math.round((Number(units) / 1e6) * NAIRA_PER_USDC);
}
