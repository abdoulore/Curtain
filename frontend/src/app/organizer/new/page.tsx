import type { Metadata } from "next";
import { CreateShowView } from "@/components/CreateShowView";

export const metadata: Metadata = { title: "Create a show · Curtain" };

export default function CreateShowPage() {
  return <CreateShowView />;
}
