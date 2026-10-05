import "server-only";
import { getAddress, type Address } from "viem";
import { curtainFactoryAbi } from "@/lib/abis";
import { CURTAIN_FACTORY } from "@/lib/chain";
import { publicClient } from "./clients";
import { RelayError } from "./relay";

let implementation: Promise<Address> | undefined;
const known = new Set<Address>();

/**
 * The relayer only pays gas for events cloned by our factory: the address must hold exactly the
 * EIP-1167 minimal proxy pointing at the factory's implementation.
 */
export async function assertCurtainEvent(event: Address): Promise<Address> {
  const address = getAddress(event);
  if (known.has(address)) return address;
  implementation ??= publicClient.readContract({
    address: CURTAIN_FACTORY,
    abi: curtainFactoryAbi,
    functionName: "implementation",
  });
  const impl = (await implementation).toLowerCase().slice(2);
  const expected = `0x363d3d373d3d3d363d73${impl}5af43d82803e903d91602b57fd5bf3`;
  const code = await publicClient.getCode({ address });
  if (code?.toLowerCase() !== expected) throw new RelayError(400, "UnknownEvent", "Not a Curtain event");
  known.add(address);
  return address;
}
