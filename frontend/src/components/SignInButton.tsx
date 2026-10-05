"use client";

import { useState } from "react";
import { friendlyPasskeyError, isPrfUnavailable, signIn } from "@/lib/account";
import { ContinueOnPhone } from "./ContinueOnPhone";

/** Restores a Curtain account from any passkey this device can use, for example one synced from another device. */
export function SignInButton({ variant = "primary", label = "Sign in with your passkey" }: { variant?: "primary" | "link"; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      if (isPrfUnavailable(e)) setNeedsPhone(true);
      else setError(friendlyPasskeyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (needsPhone) return <ContinueOnPhone />;

  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className={
          variant === "primary"
            ? "w-full rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50"
            : "text-sm font-semibold text-velvet underline underline-offset-2 disabled:opacity-50"
        }
      >
        {busy ? "Confirm with your fingerprint or Face ID" : label}
      </button>
      {error && <p className="mt-2 text-sm text-stop">{error}</p>}
    </div>
  );
}
