import { InvoicePrintView } from "@/components/services/invoice-print";

export const metadata = { title: "Print invoice" };

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <InvoicePrintView invoiceId={invoiceId} />;
}
