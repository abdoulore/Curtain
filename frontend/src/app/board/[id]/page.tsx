import { notFound } from "next/navigation";
import { BoardView } from "@/components/BoardView";
import { findEvent } from "@/lib/events";

export const metadata = { title: "Money board · Curtain" };

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = findEvent(id);
  if (!meta) notFound();
  return <BoardView meta={meta} />;
}
