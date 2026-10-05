"use client";

import { useEffect, useMemo, useState } from "react";
import { getAddress, type Hash } from "viem";
import type { StoredAccount } from "./account";
import { CATALOG_EVENTS } from "./events";
import { useSavedTickets } from "./hooks";
import { fetchTicketsOf } from "./indexer";
import { ticketsHeldOnChain } from "./reads";
import type { SavedTicket } from "./tickets";

const key = (t: SavedTicket) => `${t.event.toLowerCase()}-${t.ticketId}`;

/**
 * Every ticket this account holds: the ones this device bought, plus the ones the indexer (or, if it is down,
 * each listed escrow) says the account holds. Newest first.
 */
export function useMyTickets(account: StoredAccount | null): SavedTicket[] {
  const saved = useSavedTickets();
  const [remote, setRemote] = useState<SavedTicket[]>([]);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    const owner = account.address;
    fetchTicketsOf(owner)
      .then((rows) =>
        rows.map((r) => ({
          event: getAddress(r.show_id),
          ticketId: r.ticketId,
          owner,
          hash: r.boughtTx as Hash,
          boughtAt: Number(r.boughtAt) * 1000,
        })),
      )
      .catch(async () =>
        (await ticketsHeldOnChain(owner, CATALOG_EVENTS)).map((t) => ({
          event: t.event,
          ticketId: t.ticketId.toString(),
          owner,
          hash: "0x" as Hash,
          boughtAt: 0,
        })),
      )
      .then((list) => alive && setRemote(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account]);

  return useMemo(() => {
    if (!account) return [];
    const local = saved.filter((t) => t.owner.toLowerCase() === account.address.toLowerCase());
    const seen = new Set(local.map(key));
    return [...local, ...remote.filter((t) => !seen.has(key(t)))].sort((a, b) => b.boughtAt - a.boughtAt);
  }, [account, saved, remote]);
}
