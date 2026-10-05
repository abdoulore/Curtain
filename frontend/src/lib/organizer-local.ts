"use client";

import type { Address, Hash } from "viem";

/**
 * Small per-device notes for organizers, so the dashboard works before the indexer catches up: the shows created
 * here and the gate devices paired from here. The chain stays the source of truth (each gate is re-checked).
 */
const SHOWS_KEY = "curtain.myShows.v1";
const gatesKey = (event: Address) => `curtain.pairedGates.v1.${event.toLowerCase()}`;

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export type CreatedShow = { event: Address; organizer: Address; name: string; hash: Hash; at: number };

export function rememberCreatedShow(show: CreatedShow) {
  write(SHOWS_KEY, [show, ...read<CreatedShow[]>(SHOWS_KEY, []).filter((s) => s.event !== show.event)].slice(0, 50));
}
export function createdShows(organizer: Address): CreatedShow[] {
  return read<CreatedShow[]>(SHOWS_KEY, []).filter((s) => s.organizer.toLowerCase() === organizer.toLowerCase());
}
export function createdShow(event: Address): CreatedShow | undefined {
  return read<CreatedShow[]>(SHOWS_KEY, []).find((s) => s.event.toLowerCase() === event.toLowerCase());
}

export function rememberPairedGate(event: Address, gate: Address) {
  write(gatesKey(event), [...new Set([...read<string[]>(gatesKey(event), []), gate])]);
}
export function pairedGates(event: Address): Address[] {
  return read<Address[]>(gatesKey(event), []);
}
