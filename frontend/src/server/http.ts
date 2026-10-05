import "server-only";
import { z } from "zod";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { RelayError, toRelayError } from "./relay";

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

export function ok(data: unknown, status = 200): Response {
  return new Response(stringify(data), { status, headers: { "content-type": "application/json" } });
}

export function fail(error: unknown): Response {
  const e = error instanceof z.ZodError ? new RelayError(400, "BadRequest", z.prettifyError(error)) : toRelayError(error);
  if (e.status >= 500) console.error(e.code, e.message);
  return ok({ error: e.code, message: e.message, details: e.details }, e.status);
}

export async function parse<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RelayError(400, "BadRequest", "Body must be JSON");
  }
  return schema.parse(body);
}

// Shared field schemas. Numbers travel as decimal strings so bigints survive JSON.
export const address = z.string().refine((s) => isAddress(s), "not an address").transform((s) => getAddress(s) as Address);
export const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "not 32 bytes of hex").transform((s) => s as Hex);
export const hexBytes = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "not hex bytes").transform((s) => s as Hex);
export const uint = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
