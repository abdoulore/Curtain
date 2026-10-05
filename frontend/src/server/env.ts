import "server-only";
import type { Hex } from "viem";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 0x-prefixed 32 byte hex key`);
  return value as Hex;
}

/** Read lazily so a missing variable fails the request that needs it, not the build. */
export const env = {
  alchemyApiKey: () => process.env.ALCHEMY_API_KEY,
  /** Pays gas for buys, resales and other holder actions. */
  relayerKey: () => privateKey("RELAYER_PRIVATE_KEY"),
  /** A registered gate on the events it checks in for. */
  gateKey: () => privateKey("GATE_PRIVATE_KEY"),
  /** Holds testnet USDC for top-ups. */
  treasuryKey: () => privateKey("TREASURY_PRIVATE_KEY"),
  /** Signs gate nonces so a check-in proves "at this gate, just now". */
  gateSecret: () => required("GATE_SECRET"),
  /** Shared code a gate screen sends to get nonces. */
  gateAccessCode: () => required("GATE_ACCESS_CODE"),
  topupAmount: () => BigInt(process.env.TOPUP_AMOUNT ?? "3000000"), // 3 USDC
};
