import "server-only";
import { getAddress, type Address } from "viem";
import { curtainEventAbi, curtainFactoryAbi } from "@/lib/abis";
import { CURTAIN_FACTORY, USDC } from "@/lib/chain";
import { publicClient } from "./clients";
import { RelayError } from "./relay";

let implementation: Promise<Address> | undefined;
const known = new Set<Address>();

/** The EIP-1167 minimal proxy runtime code that OZ Clones deploys for `impl`. */
export function cloneCode(impl: Address): string {
  return `0x363d3d373d3d3d363d73${impl.toLowerCase().slice(2)}5af43d82803e903d91602b57fd5bf3`;
}

/** The relayer only pays gas for events priced in testnet USDC. */
export function isSupportedToken(token: Address): boolean {
  return getAddress(token) === getAddress(USDC);
}

/**
 * The relayer only pays gas for events cloned by our factory (the address holds exactly the EIP-1167 proxy to the
 * factory's implementation) whose token is testnet USDC.
 */
export async function assertCurtainEvent(event: Address): Promise<Address> {
  const address = getAddress(event);
  if (known.has(address)) return address;
  implementation ??= publicClient.readContract({
    address: CURTAIN_FACTORY,
    abi: curtainFactoryAbi,
    functionName: "implementation",
  });
  const code = await publicClient.getCode({ address });
  if (code?.toLowerCase() !== cloneCode(await implementation)) {
    throw new RelayError(400, "UnknownEvent", "Not a Curtain event");
  }
  const token = await publicClient.readContract({ address, abi: curtainEventAbi, functionName: "token" });
  if (!isSupportedToken(token)) {
    throw new RelayError(400, "UnsupportedToken", "This event is not priced in a currency Curtain supports yet");
  }
  known.add(address);
  return address;
}
