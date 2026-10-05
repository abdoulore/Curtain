import { notFound } from "next/navigation";
import { BoardView } from "@/components/BoardView";
import { loadEvent } from "@/server/show-meta";

export const metadata = { title: "Money board · Curtain" };

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await loadEvent(id);
  if (!meta) notFound();
  return <BoardView meta={meta} />;
}
