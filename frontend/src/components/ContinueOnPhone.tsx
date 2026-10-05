"use client";

import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Never a dead end: when this browser can't hold a ticket, pick up the same page on the phone. */
export function ContinueOnPhone({ reason }: { reason?: string }) {
  const url = useSyncExternalStore(noop, () => window.location.href, () => "");
  return (
    <div className="rounded-2xl border border-line bg-background p-4 text-center">
      <p className="font-semibold">Continue on your phone</p>
      <p className="mt-1 text-sm text-muted">
        {reason ?? "This browser can't hold a Curtain ticket."} Scan with your phone&apos;s camera to pick up right here.
      </p>
      {url && (
        <div className="mx-auto mt-4 w-fit rounded-xl bg-white p-3">
          <QRCodeSVG value={url} level="M" marginSize={1} className="h-44 w-44" />
        </div>
      )}
    </div>
  );
}
