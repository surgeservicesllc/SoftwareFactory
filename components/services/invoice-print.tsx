"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * One invoice, laid out to be printed.
 *
 * Like the WDO report: "PDF" is the browser's own print-to-PDF over a
 * page designed for paper — no server renderer is connected and none is
 * pretended. The page prints what the ledger holds: the lines that sum
 * to the subtotal, the payments netted into paid, the balance derived
 * rather than stored — and a DRAFT banner on anything unissued, plus a
 * VOID banner with its reason, so neither can circulate as a bill.
 */

type InvoiceLine = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
};

type Invoice = {
  id: string;
  accountId: string;
  number: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issuedOn: string | null;
  dueOn: string | null;
  memo: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: InvoiceLine[];
};

type Account = { id: string; name: string };

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function InvoicePrintView({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [accountName, setAccountName] = useState<string>("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const [invoicesResponse, accountsResponse] = await Promise.all([
        fetch("/api/services/invoices", { headers: { accept: "application/json" }, cache: "no-store" }),
        fetch("/api/services/accounts", { headers: { accept: "application/json" }, cache: "no-store" }),
      ]);
      if (!invoicesResponse.ok) {
        setState("error");
        return;
      }
      const body = (await invoicesResponse.json()) as { invoices?: Invoice[] };
      const found = (body.invoices ?? []).find((row) => row.id === invoiceId) ?? null;
      if (!found) {
        setState("error");
        return;
      }
      if (accountsResponse.ok) {
        const accountsBody = (await accountsResponse.json()) as { accounts?: Account[] };
        setAccountName(
          (accountsBody.accounts ?? []).find((account) => account.id === found.accountId)?.name ?? "",
        );
      }
      setInvoice(found);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [invoiceId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  if (state === "loading") {
    return <p className="p-8 text-sm text-muted">Preparing the invoice…</p>;
  }
  if (state === "error" || !invoice) {
    return (
      <p role="alert" className="p-8 text-sm text-[var(--danger)]">
        That invoice could not be loaded, or it is not yours to print.
      </p>
    );
  }

  const isDraft = invoice.status === "draft";
  const isVoid = invoice.voidedAt !== null || invoice.status === "void";

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0" data-testid="invoice-print">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>

      <div className="no-print mb-6 flex items-center justify-between gap-3 rounded border border-neutral-300 p-3">
        <p className="text-sm text-neutral-600">
          Use your browser&apos;s Print (Ctrl/Cmd+P) to save this as a PDF — the rendering happens
          on your machine, not on a server.
        </p>
        <button
          type="button"
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>

      {isDraft ? (
        <p className="mb-4 border-2 border-dashed border-red-600 p-2 text-center text-sm font-bold uppercase tracking-widest text-red-600">
          Draft — not an issued invoice
        </p>
      ) : null}
      {isVoid ? (
        <p className="mb-4 border-2 border-dashed border-red-600 p-2 text-center text-sm font-bold uppercase tracking-widest text-red-600">
          Void{invoice.voidReason ? ` — ${invoice.voidReason}` : ""}
        </p>
      ) : null}

      <header className="flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <h1 className="text-xl font-bold">Invoice {invoice.number}</h1>
          {accountName ? <p className="mt-1 text-sm">Billed to: {accountName}</p> : null}
        </div>
        <dl className="text-right text-sm">
          <div>
            <dt className="inline font-semibold">Issued: </dt>
            <dd className="inline">{invoice.issuedOn ?? "Not issued"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Due: </dt>
            <dd className="inline">{invoice.dueOn ?? "—"}</dd>
          </div>
        </dl>
      </header>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-2 font-semibold">Description</th>
            <th className="py-1 pr-2 text-right font-semibold">Qty</th>
            <th className="py-1 pr-2 text-right font-semibold">Unit</th>
            <th className="py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-600">
                No lines are recorded on this invoice.
              </td>
            </tr>
          ) : (
            invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-neutral-300">
                <td className="py-1 pr-2">{line.description}</td>
                <td className="py-1 pr-2 text-right">{line.quantity}</td>
                <td className="py-1 pr-2 text-right">{dollars(line.unitPriceCents)}</td>
                <td className="py-1 text-right">{dollars(line.amountCents)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot className="text-sm">
          <tr>
            <td colSpan={3} className="py-1 pr-2 text-right font-semibold">Subtotal</td>
            <td className="py-1 text-right">{dollars(invoice.subtotalCents)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 pr-2 text-right font-semibold">Tax</td>
            <td className="py-1 text-right">{dollars(invoice.taxCents)}</td>
          </tr>
          <tr className="border-t border-black">
            <td colSpan={3} className="py-1 pr-2 text-right font-bold">Total</td>
            <td className="py-1 text-right font-bold">{dollars(invoice.totalCents)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 pr-2 text-right font-semibold">Paid</td>
            <td className="py-1 text-right">{dollars(invoice.paidCents)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1 pr-2 text-right font-bold">Balance due</td>
            <td className="py-1 text-right font-bold">{dollars(invoice.balanceCents)}</td>
          </tr>
        </tfoot>
      </table>

      {invoice.memo ? (
        <section className="mt-4">
          <h2 className="text-base font-bold">Memo</h2>
          <p className="mt-1 text-sm">{invoice.memo}</p>
        </section>
      ) : null}

      <p className="mt-6 text-xs text-neutral-600">
        Paid reflects payments net of refunds as the ledger records them; the balance is derived
        from the ledger at print time, never stored.
      </p>
    </div>
  );
}
