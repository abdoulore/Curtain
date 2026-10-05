import Link from "next/link";

const PROMISES = [
  {
    title: "No screenshots at the door",
    body: "Your ticket opens only with your own fingerprint or Face ID.",
  },
  {
    title: "Organizers get paid as you walk in",
    body: "Each ticket's money moves the moment it is scanned.",
  },
  {
    title: "Refunds nobody has to approve",
    body: "If the show doesn't happen, unscanned tickets are refunded on their own.",
  },
];

export default function Home() {
  return (
    <main className="pt-10 lg:grid lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16 lg:pt-20">
      <section>
        <h1 className="text-4xl leading-tight font-semibold tracking-tight lg:text-6xl lg:leading-[1.05]">
          If the curtain never rises, your money comes back.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          Buy a ticket with your fingerprint or Face ID. Your money waits safely and reaches the organizer only when you
          walk in. If the show is cancelled, you get it back automatically.
        </p>
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
      <ul className="mt-10 space-y-4 text-sm lg:mt-0">
        {PROMISES.map((p) => (
          <li key={p.title} className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-base font-semibold">{p.title}</p>
            <p className="mt-1 text-muted">{p.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
