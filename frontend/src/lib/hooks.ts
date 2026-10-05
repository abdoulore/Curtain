"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseAccount, readAccountRaw, subscribeAccount, type StoredAccount } from "./account";
import { parseTickets, readTicketsRaw, subscribeTickets, type SavedTicket } from "./tickets";

/** The account saved on this device, or null. Null during server rendering. */
export function useAccount(): StoredAccount | null {
  const raw = useSyncExternalStore(subscribeAccount, readAccountRaw, () => null);
  return useMemo(() => parseAccount(raw), [raw]);
}

export function useSavedTickets(): SavedTicket[] {
  const raw = useSyncExternalStore(subscribeTickets, readTicketsRaw, () => "[]");
  return useMemo(() => parseTickets(raw), [raw]);
}

/** True after hydration, so client-only state can render without a mismatch. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const FINE_POINTER = "(pointer: fine)";

function subscribeFinePointer(onChange: () => void) {
  const m = window.matchMedia(FINE_POINTER);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** True on a laptop or desktop (a fine pointer such as a mouse or trackpad). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeFinePointer,
    () => window.matchMedia(FINE_POINTER).matches,
    () => false,
  );
}
