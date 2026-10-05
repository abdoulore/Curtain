"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "@/lib/abis";
import { gateCode, parsePairingFragment } from "@/lib/gate";
import { writeDeviceKey } from "@/lib/gate-device";
import { useHydrated } from "@/lib/hooks";
import { browserClient } from "@/lib/reads";
import { useShowMeta } from "@/lib/show-details";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const WAIT_MS = 60_000;

/**
 * Opened by scanning the pairing QR on the organizer dashboard. Keeps the gate key in this browser, waits until the
 * organizer's signed SetGate for it is onchain, then opens the gate screen.
 */
export function PairGateView() {
  const hydrated = useHydrated();
  const router = useRouter();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const pairing = useMemo(() => (hash ? parsePairingFragment(hash) : null), [hash]);
  const device = useMemo(() => (pairing ? privateKeyToAccount(pairing.gateKey) : null), [pairing]);
  const meta = useShowMeta(pairing?.event);
  const [state, setState] = useState<"waiting" | "paired" | "timeout">("waiting");

  useEffect(() => {
    if (!pairing || !device) return;
    let alive = true;
    const started = Date.now();
    const check = async () => {
      const ok = await browserClient
        .readContract({ address: pairing.event, abi: curtainEventAbi, functionName: "isGate", args: [device.address] })
        .catch(() => false);
      if (!alive) return;
      if (ok) {
        writeDeviceKey(pairing.event, pairing.gateKey);
        // Drop the key from the address bar and history before showing the gate.
        window.history.replaceState(null, "", window.location.pathname);
        setState("paired");
        router.replace(`/gate/${pairing.event}`);
      } else if (Date.now() - started > WAIT_MS) {
        setState("timeout");
      } else {
        setTimeout(check, 1_500);
      }
    };
    check();
    return () => {
      alive = false;
    };
  }, [pairing, device, router]);

  if (!hydrated) return null;

  if (!pairing || !device) {
    return (
      <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
        <h1 className="text-2xl font-semibold">Scan the pairing code</h1>
        <p className="mt-2 text-muted">
          On the organizer dashboard, tap &quot;Add a gate device&quot; and scan the code with this tablet&apos;s camera.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
      <p className="text-sm text-muted">Pairing a gate for</p>
      <h1 className="mt-1 text-2xl font-semibold">{meta?.name ?? "Curtain show"}</h1>
      <p className="mt-6 font-mono text-4xl font-semibold tracking-wider">{gateCode(device.address)}</p>
      <p className="mt-2 text-sm text-muted">The same code shows on the organizer&apos;s dashboard.</p>
      <p className={`mt-6 ${state === "timeout" ? "text-stop" : "text-muted"}`}>
        {state === "waiting"
          ? "Waiting for the organizer's approval to land onchain…"
          : state === "paired"
            ? "Paired. Opening the gate…"
            : "This code was not approved. Ask the organizer to add the device again."}
      </p>
    </main>
  );
}
