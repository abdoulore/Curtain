"use client";

import { useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";

/** Each paired tablet keeps one gate key per show, only in this browser. */
const keyFor = (event: Address) => `curtain.gateDevice.v1.${event.toLowerCase()}`;
const CHANGE = "curtain:gatedevice";

export function readDeviceKey(event: Address): Hex | null {
  try {
    const v = localStorage.getItem(keyFor(event));
    return v && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

export function writeDeviceKey(event: Address, key: Hex | null) {
  try {
    if (key) localStorage.setItem(keyFor(event), key);
    else localStorage.removeItem(keyFor(event));
  } catch {}
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useDeviceKey(event: Address): Hex | null {
  return useSyncExternalStore(subscribe, () => readDeviceKey(event), () => null);
}
