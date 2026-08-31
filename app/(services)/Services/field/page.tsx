import type { Metadata } from "next";

import { FieldPanel } from "@/components/services/field-panel";

export const metadata: Metadata = {
  title: "Today",
  description: "The technician's field surface: dispatched work, recorded with or without signal.",
};

export default function FieldPage() {
  return <FieldPanel />;
}
