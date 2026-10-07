import type { Metadata } from "next";
import { UpcomingShows } from "@/components/UpcomingShows";

export const metadata: Metadata = { title: "Shows · Curtain" };

export default function ShowsPage() {
  return (
    <main className="pt-6 lg:pt-10">
      <h1 className="text-2xl font-semibold lg:text-3xl">Upcoming shows</h1>
      <p className="mt-1 text-muted">Every ticket is protected until the show happens.</p>
      <UpcomingShows heading={false} />
    </main>
  );
}
