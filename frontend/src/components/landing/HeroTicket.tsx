"use client";

import { useEffect, useState } from "react";

/** The illustrative ticket: a fictional show at a fictional venue, priced like the demo show. */
const TICKET = {
  show: "Saturday Night Punchlines",
  when: "Sat 5 Dec · 8:00 pm",
  venue: "The Ember Room, Yaba",
  number: "014",
  price: "₦1,500",
};

const STEPS = [
  { title: `${TICKET.price} protected`, detail: "Ticket bought" },
  { title: "Fingerprint at the gate", detail: "One touch at the door" },
  { title: `${TICKET.price} paid to the organizer`, detail: "The moment you walk in" },
] as const;

const STEP_MS = 1300;

function FingerprintMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M7 10a5 5 0 0 1 10 0v2a9 9 0 0 1-1.2 4.5" />
      <path d="M12 10v3a7 7 0 0 1-2 5" />
      <path d="M9.5 10.5a2.5 2.5 0 0 1 5 0v2" />
      <path d="M4.5 13a7.5 7.5 0 0 1 1-6.5M19.5 8.5c.4 1 .5 2 .5 3" />
    </svg>
  );
}

/**
 * The hero's ticket. On first view it plays the whole product once on the ticket itself: the PROTECTED stamp, the
 * fingerprint lighting up at the gate, then the PAID stamp. With reduced motion it shows the finished state straight
 * away. The steps are also written out, visually hidden, for screen readers.
 */
export function HeroTicket() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const done = setTimeout(() => setStep(STEPS.length - 1), 0);
      return () => clearTimeout(done);
    }
    const timers = STEPS.slice(1).map((_, i) => setTimeout(() => setStep(i + 1), 900 + STEP_MS * i));
    return () => timers.forEach(clearTimeout);
  }, []);

  const paid = step === STEPS.length - 1;

  return (
    <div className="relative mx-auto w-full max-w-[26rem] lg:max-w-[30rem]">
      {/* The house light behind the ticket. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-2 -inset-y-12 rounded-full sm:-inset-x-16 bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--velvet)_14%,transparent),transparent)]"
      />

      <div
        role="img"
        aria-label={`Example ticket: ${TICKET.show}, ${TICKET.when}, ${TICKET.venue}, ticket ${TICKET.number}, ${TICKET.price}.`}
        aria-describedby="hero-ticket-steps"
        className="hero-ticket-in relative flex overflow-hidden rounded-[1.25rem] bg-surface shadow-[0_24px_60px_-28px_rgba(40,14,18,0.45)] ring-1 ring-line"
      >
        <div className="min-w-0 flex-1 p-5 sm:p-7">
          <p className="text-[0.7rem] font-semibold tracking-[0.28em] text-velvet uppercase">Curtain</p>
          <p className="mt-4 font-display text-[1.75rem] leading-[1.05] sm:text-[2.1rem]">{TICKET.show}</p>
          <dl className="mt-4 space-y-0.5 text-sm">
            <dt className="sr-only">When</dt>
            <dd className="font-medium">{TICKET.when}</dd>
            <dt className="sr-only">Where</dt>
            <dd className="text-muted">{TICKET.venue}</dd>
          </dl>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums">{TICKET.price}</p>
            <span
              className={`inline-flex -rotate-3 items-center gap-1.5 rounded-md border-2 px-2 py-1 text-[0.7rem] font-bold tracking-[0.14em] uppercase transition-colors duration-500 motion-reduce:transition-none ${
                paid ? "border-go text-go" : "border-velvet text-velvet"
              }`}
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                {paid ? <path d="M4.5 10.5l3.5 3.5 7.5-8" /> : <path d="M10 3l6 2.5v4.5c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V5.5z" />}
              </svg>
              {paid ? "Paid" : "Protected"}
            </span>
          </div>
        </div>

        {/* Perforation, with a notch cut at the top and bottom. */}
        <div aria-hidden className="relative w-0 border-l-2 border-dashed border-line">
          <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-background" />
          <span className="absolute -bottom-3 -left-3 h-6 w-6 rounded-full bg-background" />
        </div>

        <div className="flex w-24 shrink-0 flex-col items-center justify-between bg-velvet px-2 py-5 text-velvet-ink sm:w-28">
          <p className="text-center text-[0.6rem] font-semibold tracking-[0.24em] uppercase">Admit one</p>
          <FingerprintMark
            className={`h-10 w-10 transition-[opacity,transform] duration-500 motion-reduce:transition-none ${
              step >= 1 ? "scale-100 opacity-100" : "scale-90 opacity-40"
            }`}
          />
          <p className="font-mono text-lg font-semibold">#{TICKET.number}</p>
        </div>
      </div>

      {/* The story the stamp and fingerprint tell, for screen readers. */}
      <p id="hero-ticket-steps" className="sr-only">
        {STEPS.map((s) => `${s.title}: ${s.detail}.`).join(" ")}
      </p>
    </div>
  );
}
