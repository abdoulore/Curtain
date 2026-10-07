import Link from "next/link";
import { HeroTicket } from "@/components/landing/HeroTicket";
import { LiveMoney } from "@/components/landing/LiveMoney";
import { UpcomingShows } from "@/components/UpcomingShows";

function TicketGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M6 16a4 4 0 0 0 4-4h28a4 4 0 0 0 4 4v4a4 4 0 0 0 0 8v4a4 4 0 0 0-4 4H10a4 4 0 0 0-4-4v-4a4 4 0 0 0 0-8z" />
      <path d="M30 12v24" strokeDasharray="3 3" />
    </svg>
  );
}
function FingerprintGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M7 10a5 5 0 0 1 10 0v2a9 9 0 0 1-1.2 4.5" />
      <path d="M12 10v3a7 7 0 0 1-2 5" />
      <path d="M9.5 10.5a2.5 2.5 0 0 1 5 0v2" />
      <path d="M4.5 13a7.5 7.5 0 0 1 1-6.5M19.5 8.5c.4 1 .5 2 .5 3" />
    </svg>
  );
}
function PaidGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="24" cy="24" r="17" />
      <path d="M16 25l5.5 5.5L33 19" />
    </svg>
  );
}

const JOURNEY = [
  {
    n: "01",
    verb: "Buy",
    glyph: <TicketGlyph />,
    title: "₦1,500 protected",
    body: "Your money is held for the show, not handed over.",
  },
  {
    n: "02",
    verb: "Arrive",
    glyph: <FingerprintGlyph />,
    title: "One touch at the door",
    body: "Scan the gate code and confirm with your fingerprint or Face ID.",
  },
  {
    n: "03",
    verb: "Paid",
    glyph: <PaidGlyph />,
    title: "₦1,500 to the organizer",
    body: "Paid the moment you walk in. If the show doesn't happen, you're refunded automatically.",
  },
];

const TRUST = [
  { title: "No wallet", body: "Your account is made from your passkey." },
  { title: "No seed phrase", body: "Nothing to write down or lose." },
  { title: "No screenshots", body: "Only your fingerprint opens your ticket." },
];

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="grid items-center gap-12 pt-10 pb-16 lg:min-h-[calc(88vh-5rem)] lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pt-6 lg:pb-20">
        <div>
          <h1 className="max-w-[12.5ch] font-display text-[2.9rem] leading-[1.02] text-balance sm:text-6xl lg:text-[5.25rem]">
            If the curtain never rises, your money comes back.
          </h1>
          <p className="mt-6 max-w-md text-lg text-muted lg:text-xl">
            Buy with Face ID or fingerprint. Your payment stays protected until the show happens.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/shows"
              className="inline-flex items-center justify-center rounded-2xl bg-velvet px-7 py-4 text-base font-semibold text-velvet-ink hover:bg-[color-mix(in_srgb,var(--velvet)_88%,black)]"
            >
              Browse shows
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold underline-offset-4 hover:underline"
            >
              See how it works
            </Link>
          </div>
        </div>
        <HeroTicket />
      </section>

      {/* Ticket journey */}
      <section id="how-it-works" aria-labelledby="journey-heading" className="scroll-mt-6 border-t border-line py-20 lg:py-28">
        <h2 id="journey-heading" className="max-w-[16ch] font-display text-4xl leading-[1.05] sm:text-5xl">
          Your ticket pays when the show happens.
        </h2>
        <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
          {JOURNEY.map((j) => (
            <li key={j.n} className="relative md:border-t md:border-line md:pt-8">
              <div className="flex items-center gap-4 md:block">
                <span className="text-velvet">{j.glyph}</span>
                <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase md:mt-6">
                  <span className="tabular-nums">{j.n}</span> · {j.verb}
                </p>
              </div>
              <p className="mt-4 text-2xl font-semibold">{j.title}</p>
              <p className="mt-2 max-w-xs text-muted">{j.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Upcoming shows */}
      <div className="pb-20 lg:pb-28">
        <UpcomingShows limit={3} />
      </div>

      {/* Live money proof */}
      <section aria-labelledby="money-heading" className="mx-[calc(50%-50vw)] bg-stage py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <LiveMoney />
        </div>
      </section>

      {/* Biometric trust */}
      <section aria-labelledby="trust-heading" className="py-20 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-16">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-surface text-velvet ring-1 ring-line lg:h-32 lg:w-32">
            <svg viewBox="0 0 24 24" className="h-12 w-12 lg:h-16 lg:w-16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
              <path d="M7 10a5 5 0 0 1 10 0v2a9 9 0 0 1-1.2 4.5" />
              <path d="M12 10v3a7 7 0 0 1-2 5" />
              <path d="M9.5 10.5a2.5 2.5 0 0 1 5 0v2" />
              <path d="M4.5 13a7.5 7.5 0 0 1 1-6.5M19.5 8.5c.4 1 .5 2 .5 3" />
            </svg>
          </span>
          <div>
            <h2 id="trust-heading" className="max-w-[18ch] font-display text-4xl leading-[1.05] sm:text-5xl">
              Your fingerprint stays on your phone.
            </h2>
            <p className="mt-4 max-w-lg text-lg text-muted">Curtain only receives the secure confirmation that it&apos;s you.</p>
            <ul className="mt-10 grid gap-6 border-t border-line pt-8 sm:grid-cols-3">
              {TRUST.map((t) => (
                <li key={t.title}>
                  <p className="flex items-center gap-2 font-semibold">
                    <svg viewBox="0 0 20 20" className="h-4 w-4 text-go" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                    </svg>
                    {t.title}
                  </p>
                  <p className="mt-1 text-sm text-muted">{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Organizer call to action */}
      <section aria-labelledby="organize-heading" className="border-t border-line pt-20 lg:pt-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
          <div>
            <h2 id="organize-heading" className="font-display text-4xl leading-[1.05] sm:text-5xl">
              Sell the ticket.
              <br />
              Run the door.
              <br />
              Get paid.
            </h2>
            <p className="mt-4 max-w-md text-muted">
              Ticket money reaches you as people walk in. Pair any phone or tablet as your gate.
            </p>
            <Link
              href="/organizer/new"
              className="mt-8 inline-flex items-center justify-center rounded-2xl bg-foreground px-7 py-4 font-semibold text-background hover:opacity-90"
            >
              Create a show
            </Link>
          </div>

          <figure aria-label="Illustration: the organizer's dashboard and a gate screen" className="relative">
            <div aria-hidden className="grid grid-cols-[1.25fr_1fr] gap-4">
              <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
                <p className="text-xs text-muted">Saturday Night Punchlines</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums">₦1,500</p>
                <p className="text-sm text-muted">ready to withdraw</p>
                <p className="mt-4 text-sm font-medium">1 checked in · 1 sold</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full w-full bg-viz-released" />
                </div>
                <p className="mt-4 inline-flex rounded-xl bg-velvet px-3 py-1.5 text-xs font-semibold text-velvet-ink">Withdraw</p>
              </div>
              <div className="flex flex-col items-center justify-center rounded-2xl bg-admit p-4 text-center text-white">
                <svg viewBox="0 0 48 48" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                  <circle cx="24" cy="24" r="21" />
                  <path d="M14 25l7 7 13-15" />
                </svg>
                <p className="mt-2 text-2xl font-black tracking-tight">ADMIT</p>
                <p className="mt-1 font-mono text-sm">Ticket #014</p>
              </div>
            </div>
            <figcaption className="mt-3 text-xs text-muted">Your dashboard and the gate, with the ticket from the top of the page.</figcaption>
          </figure>
        </div>
      </section>
    </main>
  );
}
