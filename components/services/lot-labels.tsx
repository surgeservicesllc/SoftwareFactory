"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";

import { Notice, SectionTitle } from "@/components/ui";
import { code39Refusal, code39Svg } from "@/lib/services/code39";
import type { LotView } from "@/components/services/types";

/**
 * Printable chemical-lot labels (PestPac parity, ADR-237).
 *
 * The application record already names the lot; what was missing is the
 * label on the container, so the technician scans the lot rather than
 * typing it. Same symbology and the same refusal as station labels: a lot
 * number Code 39 cannot carry is printed as text with the reason, never
 * uppercased into a symbol that would scan as a different lot — the lot
 * key is case-sensitive per product.
 */

function Label({ lot, productName }: { lot: LotView; productName: string | null }) {
  const symbol = code39Svg(lot.lotNumber, { narrow: 2, height: 44 });
  const refusal = symbol === null ? code39Refusal(lot.lotNumber) : null;

  return (
    <li
      className="flex break-inside-avoid flex-col justify-between rounded-md border border-line p-3"
      data-testid="lot-label"
    >
      <span className="block text-sm font-medium text-foreground">{productName ?? "product"}</span>
      <span className="block text-xs text-muted">
        {lot.quantityRemaining} {lot.unit} left
        {lot.expiresOn ? ` · expires ${lot.expiresOn}` : ""}
      </span>

      {symbol === null ? (
        <span
          className="mt-2 block rounded border border-dashed border-line px-2 py-3 text-[11px] text-faint"
          data-testid="lot-label-refusal"
        >
          {refusal}
        </span>
      ) : (
        <svg
          className="mt-2 h-11 w-full"
          viewBox={`0 0 ${symbol.width} ${symbol.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Code 39 barcode for lot ${lot.lotNumber}`}
          data-testid="lot-label-symbol"
        >
          <rect width={symbol.width} height={symbol.height} fill="#fff" />
          <path d={symbol.path} fill="#000" />
        </svg>
      )}

      <span className="mt-1 block text-center font-mono text-xs tracking-wider text-foreground">
        {lot.lotNumber}
      </span>
    </li>
  );
}

export function LotLabels({
  lots,
  productName,
}: {
  lots: LotView[];
  productName: (productId: string) => string | null;
}) {
  const [open, setOpen] = useState(false);

  const printable = useMemo(() => lots.filter((lot) => lot.quantityRemaining > 0), [lots]);
  const unprintable = useMemo(
    () => printable.filter((lot) => code39Svg(lot.lotNumber) === null).length,
    [printable],
  );

  if (printable.length === 0) return null;

  return (
    <div className="mt-3" data-testid="lot-labels">
      <button
        type="button"
        className="btn btn-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs print:hidden"
        onClick={() => setOpen((current) => !current)}
      >
        <Printer className="size-3.5" aria-hidden="true" />
        {open ? "Close labels" : `Lot labels (${printable.length})`}
      </button>

      {open ? (
        <div className="mt-3">
          <div className="print:hidden">
            <SectionTitle
              title="Lot labels"
              description="One label per lot still in stock, ready for the printer. Code 39, which every handheld reads; the application record then names the lot by its scan."
            />
            {unprintable > 0 ? (
              <div className="mt-3">
                <Notice tone="warning">
                  {unprintable} of these {printable.length} lots carry a number Code 39 cannot encode,
                  so they print without a symbol and say why. Lot numbers are case-sensitive here, so an
                  uppercased symbol would scan as a different lot.
                </Notice>
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn-primary mt-3 px-3 py-1.5 text-xs"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
            {printable.map((lot) => (
              <Label key={lot.id} lot={lot} productName={productName(lot.productId)} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
