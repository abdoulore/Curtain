import Link from "next/link";

export default function Home() {
  return (
    <main className="pt-10">
      <h1 className="text-4xl leading-tight font-semibold tracking-tight">
        If the curtain never rises, your money comes back.
      </h1>
      <p className="mt-4 text-lg text-muted">
        Buy a ticket with your fingerprint or Face ID. Your money waits safely and reaches the organizer only when you
        walk in. If the show is cancelled, you get it back automatically.
      </p>
      <Link
        href="/e/demo"
        className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink"
      >
        See the demo show
      </Link>
      <ul className="mt-10 space-y-4 text-sm">
        <li className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">No screenshots at the door</p>
          <p className="mt-1 text-muted">Your ticket opens only with your own fingerprint or Face ID.</p>
        </li>
        <li className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">Organizers get paid as you walk in</p>
          <p className="mt-1 text-muted">Each ticket&apos;s money moves the moment it is scanned.</p>
        </li>
        <li className="rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">Refunds nobody has to approve</p>
          <p className="mt-1 text-muted">If the show doesn&apos;t happen, unscanned tickets are refunded on their own.</p>
        </li>
      </ul>
    </main>
  );
}
