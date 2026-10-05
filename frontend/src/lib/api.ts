"use client";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Plain-language messages for relayer and contract errors. No chain words reach the buyer. */
const FRIENDLY: Record<string, string> = {
  SoldOut: "Sold out. Every ticket has been taken.",
  SalesClosed: "Ticket sales for this show have closed.",
  EventNotOpen: "This show isn't selling tickets right now.",
  InsufficientAllowance: "Payment wasn't approved. Please try again.",
  PriceMismatch: "The price changed. Refresh and try again.",
  SignatureExpired: "That took too long. Please try again.",
  BadSignature: "We couldn't confirm it was you. Please try again.",
  InvalidPublicKey: "This passkey can't be used for tickets.",
  UnknownEvent: "We couldn't find this show.",
  RpcError: "The network is busy. Please try again in a moment.",
  TopupLimitIp: "You've had your free test money for today on this network. Try again tomorrow.",
  TopupLimitGlobal: "Lots of people are topping up right now. Try again in an hour.",
  UnsupportedToken: "This show isn't priced in a currency Curtain supports yet.",
  // At the door
  TicketNotActive: "This ticket has already been used or refunded.",
  InvalidAssertion: "This ticket belongs to someone else's fingerprint or Face ID.",
  WrongRpId: "This passkey wasn't made for Curtain.",
  ChallengeAlreadyUsed: "That gate code was already used. Scan the gate again.",
  ChallengeExpired: "That gate code expired. Scan the gate again.",
  ChallengeFromFuture: "That gate code isn't valid yet. Scan the gate again.",
  GateTokenExpired: "That gate code expired. Scan the gate again.",
  GateTokenInvalid: "That code didn't come from a Curtain gate.",
  GateTokenWrongEvent: "That gate is for a different show.",
  NotDoorTime: "Doors aren't open right now.",
  NotGate: "This gate isn't set up for the show.",
  GateUnauthorized: "Wrong gate code.",
  GateNotRegistered: "This gate isn't set up for the show.",
};

/** The plain-language message for a relayer or contract error code. */
export function friendlyMessage(code: string | undefined): string {
  return (code && FRIENDLY[code]) || "Something went wrong. Please try again.";
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : "Error";
    throw new ApiError(code, FRIENDLY[code] ?? "Something went wrong. Please try again.");
  }
  return json as T;
}
