"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState, type ReactNode } from "react";
import type { Address } from "viem";
import { friendlyPasskeyError, type StoredAccount } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { createClaimLink, revokeClaimLink } from "@/lib/claim";

/**
 * Moves a ticket to a phone whose passkey isn't synced with this device (or gifts it to a friend). The link's
 * one-time key comes from this passkey's PRF output; turning the link off makes it worthless.
 *
 * Renders its button and, once a link exists, a full-width panel ordered last, so it sits in a wrapping action strip.
 */
export function SendToPhone({
  account,
  event,
  ticketId,
  className,
  icon,
}: {
  account: StoredAccount;
  event: Address;
  ticketId: string;
  className: string;
  icon?: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const message = (e: unknown) => (e instanceof ApiError ? e.message : friendlyPasskeyError(e));

  async function create() {
    setBusy("create");
    setError(null);
    try {
      setUrl(await createClaimLink(account, event, BigInt(ticketId)));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy("revoke");
    setError(null);
    try {
      await revokeClaimLink(account, event, BigInt(ticketId));
      setUrl(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button onClick={create} disabled={busy !== null || url !== null} aria-expanded={url !== null} className={className}>
        {icon}
        {busy === "create" ? "Confirm with your fingerprint" : url ? "Link ready" : "Send"}
      </button>
      {error && (
        <p role="alert" className="order-last basis-full px-5 pb-3 text-sm text-stop">
          {error}
        </p>
      )}
      {url && (
        <div className="order-last basis-full border-t border-line bg-background p-4">
          <p className="text-sm font-semibold">Scan with your phone&apos;s camera</p>
          <p className="mt-1 text-sm text-muted">
            Your phone makes its own passkey and the ticket moves to it. You can also send this link to a friend as a
            gift.
          </p>
          <div className="mt-4 rounded-xl bg-white p-3">
            <QRCodeSVG value={url} level="M" marginSize={1} className="mx-auto h-auto w-full max-w-60" />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => {})
              }
              className="flex-1 rounded-xl border border-line px-3 py-2 text-sm font-medium"
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
            <button
              onClick={revoke}
              disabled={busy !== null}
              className="flex-1 rounded-xl border border-line px-3 py-2 text-sm font-medium text-stop disabled:opacity-50"
            >
              {busy === "revoke" ? "Turning off…" : "Turn off this link"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
