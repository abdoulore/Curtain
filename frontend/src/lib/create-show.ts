import { sha256, toBytes, type Address, type Hex, type TypedDataDefinition } from "viem";
import { createShowTypes, FACTORY_EIP712, RP_ID, USDC } from "./chain";
import { nairaToUsdcUnits } from "./money";

/** The parameters CurtainFactory hands to CurtainEvent.initialize, as the organizer signs them. */
export type ShowParams = {
  payout: Address;
  token: Address;
  price: bigint;
  capacity: number;
  salesEnd: bigint;
  doorsOpen: bigint;
  endTime: bigint;
  settleDelay: bigint;
  maxChallengeAge: number;
  maxPerBuyer: number;
  rpIdHash: Hex;
  gates: Address[];
};

export type ShowForm = {
  name: string;
  venue: string;
  /** Unix seconds when doors open. */
  startsAt: number;
  priceNaira: string;
  capacity: string;
  perPerson: string;
};

/** A show runs six hours from doors open; sales close when it ends; settlement waits an hour after. */
export const SHOW_LENGTH_SECONDS = 6 * 60 * 60;
export const SETTLE_DELAY_SECONDS = 60 * 60;
export const MAX_CAPACITY = 10_000;
/** Tickets one account may hold unless the organizer says otherwise; matches CurtainEvent.DEFAULT_MAX_PER_BUYER. */
export const DEFAULT_PER_PERSON = 4;
export const MAX_PER_PERSON = 50;

export type BuiltShow = { ok: true; name: string; venue: string; params: ShowParams } | { ok: false; error: string };

/** The first step's problem, if any: name, venue and when. */
export function eventStepError(form: Pick<ShowForm, "name" | "venue" | "startsAt">, now: number): string | null {
  const name = form.name.trim();
  const venue = form.venue.trim();
  if (name.length < 3) return "Give the show a name.";
  if (name.length > 80) return "Keep the name under 80 characters.";
  if (venue.length < 3) return "Say where it is.";
  if (venue.length > 120) return "Keep the venue under 120 characters.";
  if (!Number.isFinite(form.startsAt)) return "Pick a date and time.";
  if (form.startsAt + SHOW_LENGTH_SECONDS <= now) return "That show would already be over. Pick a later time.";
  return null;
}

/** The second step's problem, if any: price, capacity and tickets per person. */
export function ticketStepError(form: Pick<ShowForm, "priceNaira" | "capacity" | "perPerson">): string | null {
  if (nairaToUsdcUnits(form.priceNaira) === null) return "Set a ticket price in naira.";
  const capacity = Number(form.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    return `Capacity must be a whole number from 1 to ${MAX_CAPACITY.toLocaleString()}.`;
  }
  const perPerson = Number(form.perPerson);
  if (!Number.isInteger(perPerson) || perPerson < 1 || perPerson > MAX_PER_PERSON) {
    return `Tickets per person is a whole number from 1 to ${MAX_PER_PERSON}.`;
  }
  return null;
}

/** Checks the create form and turns it into contract parameters. Gates are paired after creation. */
export function buildShow(form: ShowForm, organizer: Address, now: number): BuiltShow {
  const error = eventStepError(form, now) ?? ticketStepError(form);
  if (error) return { ok: false, error };
  const name = form.name.trim();
  const venue = form.venue.trim();
  const endTime = form.startsAt + SHOW_LENGTH_SECONDS;
  const price = nairaToUsdcUnits(form.priceNaira)!;
  const capacity = Number(form.capacity);
  const perPerson = Number(form.perPerson);
  return {
    ok: true,
    name,
    venue,
    params: {
      payout: organizer,
      token: USDC,
      price,
      capacity,
      salesEnd: BigInt(endTime),
      doorsOpen: BigInt(form.startsAt),
      endTime: BigInt(endTime),
      settleDelay: BigInt(SETTLE_DELAY_SECONDS),
      maxChallengeAge: 300,
      maxPerBuyer: perPerson,
      rpIdHash: sha256(toBytes(RP_ID)),
      gates: [],
    },
  };
}

/** The exact typed data CurtainFactory.createEventFor verifies. */
export function createShowTypedData(
  organizer: Address,
  name: string,
  venue: string,
  show: ShowParams,
  nonce: bigint,
  deadline: bigint,
): TypedDataDefinition {
  return {
    domain: FACTORY_EIP712,
    types: createShowTypes,
    primaryType: "CreateShow",
    message: { organizer, name, venue, show, nonce, deadline },
  };
}

/** JSON-safe body for /api/relay/create. */
export function createShowBody(organizer: Address, name: string, venue: string, show: ShowParams, nonce: bigint, deadline: bigint, sig: Hex) {
  return {
    organizer,
    name,
    venue,
    params: {
      ...show,
      price: show.price.toString(),
      salesEnd: show.salesEnd.toString(),
      doorsOpen: show.doorsOpen.toString(),
      endTime: show.endTime.toString(),
      settleDelay: show.settleDelay.toString(),
    },
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    sig,
  };
}
