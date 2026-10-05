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
