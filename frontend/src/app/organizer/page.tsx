import type { Metadata } from "next";
import { MyShowsView } from "@/components/MyShowsView";

export const metadata: Metadata = { title: "Your shows · Curtain", robots: { index: false } };

export default function OrganizerHome() {
  return <MyShowsView />;
}
