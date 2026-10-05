import type { Metadata } from "next";
import { PairGateView } from "@/components/PairGateView";

export const metadata: Metadata = { title: "Pair a gate · Curtain", robots: { index: false } };

export default function PairGatePage() {
  return <PairGateView />;
}
