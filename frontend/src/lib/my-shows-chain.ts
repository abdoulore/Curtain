"use client";

import { getAddress, type Address } from "viem";
import { curtainEventAbi } from "./abis";
import { CURTAIN_FACTORY } from "./chain";
import type { MyShowRow } from "./indexer";
import { browserClient, readEventInfo } from "./reads";
import { readShowDetails } from "./show-details";
import { factoryShowAddresses } from "./upcoming";

/** An organizer's shows read straight from the factory's clones, for when the indexer is unavailable. Newest first. */
export async function showsOfOnChain(organizer: Address): Promise<MyShowRow[]> {
  const read = <T,>(address: Address, functionName: string) =>
    browserClient.readContract({ address, abi: curtainEventAbi, functionName } as never) as Promise<T>;
  const nonce = await browserClient.getTransactionCount({ address: CURTAIN_FACTORY });
  const addresses = factoryShowAddresses(CURTAIN_FACTORY, nonce, 500);
  const owners = await Promise.all(addresses.map((a) => read<Address>(a, "organizer").catch(() => null)));
  const mine = addresses.filter((_, i) => owners[i] && getAddress(owners[i]) === getAddress(organizer));
  const rows = await Promise.all(
    mine.map(async (address): Promise<MyShowRow | null> => {
      const [info, details, checkedIn, released, withdrawn] = await Promise.all([
        readEventInfo(address).catch(() => null),
        readShowDetails(address),
        read<number>(address, "checkedIn").catch(() => 0),
        read<bigint>(address, "released").catch(() => 0n),
        read<bigint>(address, "withdrawn").catch(() => 0n),
      ]);
      if (!info) return null;
      return {
        id: address.toLowerCase(),
        name: details?.name ?? "",
        venue: details?.venue ?? "",
        status: info.status,
        sold: info.sold,
        checkedIn: Number(checkedIn),
        doorsOpen: String(info.doorsOpen),
        endTime: String(info.endTime),
        released: String(released),
        withdrawn: String(withdrawn),
      };
    }),
  );
  return rows.filter((r): r is MyShowRow => r !== null);
}
