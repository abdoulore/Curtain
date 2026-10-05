"use client";

import { useEffect, useMemo, useState } from "react";
import type { Hash } from "viem";
import type { StoredAccount } from "./account";
import { heldTickets } from "./held-tickets";
import { useSavedTickets } from "./hooks";
import type { SavedTicket } from "./tickets";

const key = (t: SavedTicket) => `${t.event.toLowerCase()}-${t.ticketId}`;

/**
 * Every ticket this account holds: the ones this device bought, plus the ones the indexer (or, when it has nothing,
 * each listed escrow) says the account holds. Newest first.
 */
export function useMyTickets(account: StoredAccount | null): SavedTicket[] {
  const saved = useSavedTickets();
  const [remote, setRemote] = useState<SavedTicket[]>([]);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    const owner = account.address;
    heldTickets(owner)
      .then((held) =>
        held.map((t) => ({
          event: t.event,
          ticketId: t.ticketId.toString(),
          owner,
          hash: t.boughtTx ?? ("0x" as Hash),
          boughtAt: t.boughtAt ?? 0,
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
