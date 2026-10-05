import { notFound } from "next/navigation";
import { EventView } from "@/components/EventView";
import { loadEvent } from "@/server/show-meta";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await loadEvent(id);
  if (!meta) notFound();
  return <EventView meta={meta} />;
}
