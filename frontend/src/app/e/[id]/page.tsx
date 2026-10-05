import { notFound } from "next/navigation";
import { EventView } from "@/components/EventView";
import { findEvent } from "@/lib/events";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = findEvent(id);
  if (!meta) notFound();
  return <EventView meta={meta} />;
}
