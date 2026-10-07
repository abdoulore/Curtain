import Link from "next/link";
import { UpcomingShows } from "@/components/UpcomingShows";
import { BUYER_PROMISE } from "@/lib/copy";

const BENEFITS = [
  {
    title: "No screenshots at the door",
    body: "Your ticket opens only with your own fingerprint or Face ID.",
  },
  {
    title: "Organizers get paid as you walk in",
    body: "Each ticket's money is paid to the organizer the moment it's checked in.",
  },
  {
    title: "Refunds nobody has to approve",
    body: "If the show doesn't happen, unscanned tickets are refunded automatically.",
  },
];

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  );
}
function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M7 10a5 5 0 0 1 10 0v2a9 9 0 0 1-1.2 4.5" />
      <path d="M12 10v3a7 7 0 0 1-2 5" />
      <path d="M9.5 10.5a2.5 2.5 0 0 1 5 0v2" />
      <path d="M4.5 13a7.5 7.5 0 0 1 1-6.5M19.5 8.5c.4 1 .5 2 .5 3" />
    </svg>
  );
}
function PaidIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

const STEPS = [
  { icon: <TicketIcon />, title: "Ticket bought", detail: "₦1,500 protected", tone: "text-viz-held" },
  { icon: <FingerprintIcon />, title: "Fingerprint at the gate", detail: "Checked in with one touch", tone: "text-foreground" },
  { icon: <PaidIcon />, title: "₦1,500 paid to the organizer", detail: "The moment you walk in", tone: "text-go" },
];

export default function Home() {
  return (
    <main>
      <div className="pt-10 lg:grid lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16 lg:pt-20">
        <section>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight lg:text-6xl lg:leading-[1.05]">
            If the curtain never rises, your money comes back.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">{BUYER_PROMISE}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/e/demo"
              className="inline-flex items-center justify-center rounded-2xl bg-velvet px-6 py-4 text-base font-semibold text-velvet-ink"
            >
              See the demo show
            </Link>
            <Link
              href="/board/demo"
              className="inline-flex items-center justify-center rounded-2xl border border-line px-6 py-4 text-base font-semibold"
            >
              Watch the money move
            </Link>
          </div>
        </section>

        <ol className="mt-10 lg:mt-0" aria-label="How a ticket pays out">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 lg:p-5">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-background ${s.tone}`}>
                  {s.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold">{s.title}</span>
                  <span className="block text-sm text-muted">{s.detail}</span>
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="flex justify-center py-1 text-muted">
                  ↓
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>

      <section id="how-it-works" className="mt-14 scroll-mt-6 lg:mt-20" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-xl font-semibold lg:text-2xl">
          How it works
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <li key={b.title} className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-base font-semibold">{b.title}</p>
              <p className="mt-1 text-muted">{b.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <UpcomingShows limit={3} />
    </main>
  );
}
