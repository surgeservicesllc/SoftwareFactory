import { WdoPrintView } from "@/components/services/wdo-print";

export const metadata = { title: "Print report" };

export default async function WdoPrintPage({
  params,
}: {
  params: Promise<{ inspectionId: string }>;
}) {
  const { inspectionId } = await params;
  return <WdoPrintView inspectionId={inspectionId} />;
}
