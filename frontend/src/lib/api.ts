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
  InvalidPublicKey: "Use your Curtain passkey for tickets.",
  UnknownEvent: "We couldn't find this show.",
  RpcError: "The network is slow right now. Try again in a moment.",
  RelayerRefilling: "Curtain is topping up its network fees. Try again in a few minutes.",
  RevertedOnchain: "That didn't go through. Please try again.",
  InternalError: "Something went wrong on our side. Please try again.",
  BadRequest: "Something in that request wasn't right. Refresh the page and try again.",
  ServerBusy: "Curtain is busy right now. Try again in a moment.",
  TooManyRequests: "Too many tries. Wait a moment and try again.",
  InsufficientBalance: "There isn't enough in your balance for this ticket.",
  SafeERC20FailedOperation: "The payment didn't go through. Please try again.",
  InvalidAccountNonce: "That request was already used. Please try again.",
  ZeroAddress: "Something in that request wasn't right. Refresh the page and try again.",
  TopupLimitIp: "You've had today's demo money on this network. Try again tomorrow.",
  DemoMoneyRefilling: "Demo money is being refilled. Try again in a few minutes.",
  TopupLimitGlobal: "Lots of people are topping up right now. Try again in an hour.",
  LimitStoreUnavailable: "Demo money is paused for a moment. Try again shortly.",
  GasCeiling: "Curtain has reached today's safety limit for this. Please try again tomorrow.",
  UnsupportedToken: "This show doesn't accept that kind of payment.",
  // At the door
  TicketNotActive: "This ticket has already been used or refunded.",
  InvalidAssertion: "This ticket belongs to someone else's fingerprint or Face ID.",
  WrongRpId: "This passkey wasn't made for Curtain.",
  ChallengeAlreadyUsed: "That gate code was already used. Scan the gate again.",
  ChallengeExpired: "That gate code expired. Scan the gate again.",
  ChallengeFromFuture: "That gate code isn't valid yet. Scan the gate again.",
  GateTokenWrongEvent: "That gate is for a different show.",
  NotDoorTime: "Doors aren't open right now.",
  NotGate: "That gate was removed or isn't paired for this show. Scan the code at another gate.",
  GateUnauthorized: "This screen was removed as a gate for the show. Ask the organizer to pair it again.",
  GateAuthExpired: "This gate's clock is off. Reload the gate screen.",
  TooManyTickets: "You've reached this show's ticket limit per person.",
  // Resale
  PriceAboveCap: "Tickets can only be resold at face value or less.",
  NotListed: "That resale ticket was just taken. Refresh to see what's left.",
  WrongSale: "That offer changed. Refresh and try again.",
  NoClaimKey: "This link was turned off by the ticket's owner.",
  NotRefundable: "This ticket can't be refunded.",
  NothingToRefund: "There's nothing left to refund.",
  NotHolder: "Only the ticket's holder can do that.",
  // Organizers
  NotOrganizer: "Only the show's organizer can do that.",
  ExceedsReleased: "That's more than is ready to withdraw.",
  CreateLimitIp: "You've created the most shows allowed today from this network.",
  CreateLimitGlobal: "Lots of shows are being created right now. Try again in an hour.",
  NotCreated: "The show wasn't created. Please try again.",
  InvalidParams: "Some of the show's details aren't valid. Check them and try again.",
  StringTooLong: "The show's name or venue is too long.",
  InvalidShortString: "The show's name or venue is too long.",
  NotSettleable: "The show can't be confirmed yet.",
};

/** The plain-language message for a relayer or contract error code. */
export function friendlyMessage(code: string | undefined): string {
  return (code && FRIENDLY[code]) || "Something went wrong. Please try again.";
}

/** The error code for a failed response: the relayer's own, or one from the HTTP status (a timeout, a rate limit). */
export function errorCode(status: number, json: { error?: unknown }): string {
  if (typeof json.error === "string") return json.error;
  if (status === 429) return "TooManyRequests";
  if (status >= 500) return "ServerBusy";
  return "Error";
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = errorCode(res.status, json);
    throw new ApiError(code, friendlyMessage(code));
  }
  return json as T;
}

/** Multipart POST (for files), with the same error handling as postJson. */
export async function postForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = errorCode(res.status, json);
    const message = FRIENDLY[code] ?? (typeof json.message === "string" ? json.message : friendlyMessage(code));
    throw new ApiError(code, message);
  }
  return json as T;
}
