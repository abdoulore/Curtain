import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GateView } from "@/components/GateView";
import { findEvent } from "@/lib/events";

export const metadata: Metadata = { title: "Gate · Curtain", robots: { index: false } };

export default async function GatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = findEvent(id);
  if (!meta) notFound();
  return <GateView meta={meta} />;
}
