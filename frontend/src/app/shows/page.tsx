import type { Metadata } from "next";
import { UpcomingShows } from "@/components/UpcomingShows";

export const metadata: Metadata = { title: "Shows · Curtain" };

export default function ShowsPage() {
  return (
    <main className="pt-6 lg:pt-10">
      <h1 className="font-display text-4xl leading-none sm:text-5xl">Shows</h1>
      <p className="mt-3 text-muted">Every ticket is protected until the show happens.</p>
      <UpcomingShows heading={false} />
    </main>
  );
}
