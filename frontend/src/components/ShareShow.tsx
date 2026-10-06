"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { RP_ID } from "@/lib/chain";
import { eventPath, type EventMeta } from "@/lib/events";

/** The show's public ticket page, with ways to send it: open, copy, share, or a QR for posters and screens. */
export function ShareShow({ meta }: { meta: EventMeta }) {
  const path = eventPath(meta);
  const url = `https://${RP_ID}${path}`;
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function share() {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: meta.name, text: `Tickets for ${meta.name}`, url }).catch(() => {});
    } else {
      await copy();
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-velvet/40 bg-surface p-5 lg:flex lg:items-center lg:justify-between lg:gap-6">
      <div className="min-w-0">
        <p className="font-semibold">Sell tickets</p>
        <p className="mt-1 text-sm text-muted">
          This is your show&apos;s ticket page. Share it on WhatsApp or anywhere; buyers pay with their fingerprint or
          Face ID.
        </p>
        <p className="mt-2 truncate font-mono text-sm">{url.replace("https://", "")}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:mt-0 lg:flex lg:shrink-0">
        <Link
          href={path}
          className="col-span-2 rounded-xl bg-velvet px-4 py-2.5 text-center text-sm font-semibold text-velvet-ink sm:col-span-1"
        >
          Open ticket page
        </Link>
        <button onClick={share} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
          Share
        </button>
        <button onClick={copy} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          onClick={() => setShowQr((v) => !v)}
          className="col-span-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold sm:col-span-1"
        >
          {showQr ? "Hide QR" : "QR code"}
        </button>
      </div>
      {showQr && (
        <div className="mx-auto mt-4 w-48 rounded-2xl bg-white p-3 lg:mt-0">
          <QRCodeSVG value={url} level="M" marginSize={1} className="h-auto w-full" />
        </div>
      )}
    </section>
  );
}
