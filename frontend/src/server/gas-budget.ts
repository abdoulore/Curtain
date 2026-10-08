import "server-only";
import { limitStore, type CounterStore } from "./limits";
import { RelayError } from "./relay";

/** Every route that makes the relayer or the treasury pay gas. */
export const GAS_ROUTES = ["buy", "checkin", "claim", "create", "keeper", "list", "organizer", "setclaim", "topup"] as const;
export type GasRoute = (typeof GAS_ROUTES)[number];

/**
 * Gas limit (Monad charges the limit, not the gas used) each route may spend per UTC day. Sized from the measured
 * gas per call: about 500 buys, 500 check-ins, 40 new shows and 40 refund batches a day. Override with GAS_CEILING_<ROUTE>.
 */
const DEFAULT_CEILINGS: Record<GasRoute, number> = {
  buy: 150_000_000,
  checkin: 75_000_000,
  claim: 20_000_000,
  create: 20_000_000,
  // Settlements and refund batches (about 500k gas per batch of 10 refunds).
  keeper: 20_000_000,
  list: 20_000_000,
  organizer: 30_000_000,
  setclaim: 20_000_000,
  topup: 20_000_000,
};

export function gasCeiling(route: GasRoute, environment: NodeJS.ProcessEnv = process.env): number {
  const override = Number(environment[`GAS_CEILING_${route.toUpperCase()}`]);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_CEILINGS[route];
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
export const gasKey = (route: GasRoute, now = Date.now()) => `gas:${route}:${day(now)}`;
const TWO_DAYS = 2 * 24 * 60 * 60;

/**
 * Charges a transaction's gas limit to its route's budget for today, before it is sent. Over the ceiling, the
 * charge is taken back and the call refused. If the shared store can't be reached the transaction still goes
 * ahead, so an outage there never stops guests at the door; health reports the store as unavailable.
 */
export async function chargeGas(
  route: GasRoute,
  gasLimit: bigint,
  store: CounterStore = limitStore(),
  now = Date.now(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const key = gasKey(route, now);
  const gas = Number(gasLimit);
  let total: number;
  try {
    total = await store.add(key, gas, TWO_DAYS);
  } catch {
    console.error("GasBudgetUnavailable", route);
    return;
  }
  if (total > gasCeiling(route, environment)) {
    await store.add(key, -gas, TWO_DAYS).catch(() => {});
    throw new RelayError(503, "GasCeiling", `The daily gas ceiling for ${route} is reached.`);
  }
}

/** A guard for sendContract that charges this route's budget. */
export const gasGuard = (route: GasRoute) => (gasLimit: bigint) => chargeGas(route, gasLimit);

export type GasUsage = Record<GasRoute, { used: number; ceiling: number }>;

/** Today's gas per route against its ceiling, for the health report. */
export async function gasUsage(store: CounterStore = limitStore(), now = Date.now()): Promise<GasUsage> {
  const entries = await Promise.all(
    GAS_ROUTES.map(async (route) => [route, { used: await store.get(gasKey(route, now)), ceiling: gasCeiling(route) }] as const),
  );
  return Object.fromEntries(entries) as GasUsage;
}
