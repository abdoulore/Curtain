"use client";

import type { Address, Hash } from "viem";

/**
 * Tickets this device bought. The chain is the source of truth for each ticket's state; this list only
 * remembers which ones to look up until the Envio indexer serves "my tickets".
 */
export type SavedTicket = { event: Address; ticketId: string; owner: Address; hash: Hash; boughtAt: number };

const STORAGE_KEY = "curtain.tickets.v1";
const CHANGE_EVENT = "curtain:tickets";

export function readTicketsRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function parseTickets(raw: string): SavedTicket[] {
  try {
    return JSON.parse(raw) as SavedTicket[];
  } catch {
    return [];
  }
}

export function subscribeTickets(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function saveTicket(ticket: SavedTicket) {
  const all = parseTickets(readTicketsRaw()).filter((t) => !(t.event === ticket.event && t.ticketId === ticket.ticketId));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([ticket, ...all]));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
