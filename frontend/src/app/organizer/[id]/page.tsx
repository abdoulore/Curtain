import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganizerView } from "@/components/OrganizerView";
import { loadEvent } from "@/server/show-meta";

export const metadata: Metadata = { title: "Organizer · Curtain", robots: { index: false } };

export default async function OrganizerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await loadEvent(id);
  if (!meta) notFound();
  return <OrganizerView meta={meta} />;
}
