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
};

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
