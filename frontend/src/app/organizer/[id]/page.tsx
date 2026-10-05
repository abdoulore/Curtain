import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganizerView } from "@/components/OrganizerView";
import { findEvent } from "@/lib/events";

export const metadata: Metadata = { title: "Organizer · Curtain", robots: { index: false } };

export default async function OrganizerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = findEvent(id);
  if (!meta) notFound();
  return <OrganizerView meta={meta} />;
}
