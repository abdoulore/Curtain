"use client";

import { useState, useSyncExternalStore } from "react";
import { inAppBrowser } from "@/lib/webauthn";

const noop = () => () => {};

/** In-app browsers (WhatsApp, X, Instagram...) usually cannot use passkeys, so send the buyer to a real browser. */
export function InAppBrowserNotice() {
  const app = useSyncExternalStore(noop, () => inAppBrowser(navigator.userAgent), () => null);
  const [copied, setCopied] = useState(false);
  if (!app) return null;

  return (
    <div className="mx-auto mt-3 w-full max-w-5xl px-4">
      <div className="rounded-2xl border border-velvet/40 bg-velvet/10 p-4 text-sm">
        <p className="font-semibold">Open this page in Safari or Chrome</p>
        <p className="mt-1 text-muted">
          You&apos;re inside {app}, which can&apos;t use your fingerprint or Face ID. Tap the menu and choose
          &ldquo;Open in browser&rdquo;, or copy the link.
        </p>
        <button
          onClick={() =>
            navigator.clipboard
              .writeText(window.location.href)
              .then(() => setCopied(true))
              .catch(() => {})
          }
          className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 font-medium"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
