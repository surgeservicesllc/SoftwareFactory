"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";

import { Notice, SectionTitle } from "@/components/ui";
import { code39Refusal, code39Svg } from "@/lib/services/code39";
import type { DeviceView } from "@/components/services/types";

/**
 * Printable station labels (PestBoss parity).
 *
 * Barcodes were already assigned and unique per workspace, so a scan
 * resolved to exactly one station. What was missing is the other half: a
 * label a technician can stick on the station in the first place.
 *
 * It prints from the browser rather than becoming a PDF, deliberately.
 * A PDF would need object storage, which is not configured — the same
 * thing that makes the commercial portal say Not Connected about
 * downloading a signed inspection. A print stylesheet needs nothing, and
 * "print" is what an operator actually wanted.
 *
 * A station whose barcode Code 39 cannot carry still gets a label, with the
 * value in text and the reason printed beside it. That is a worse label and
 * a true one: uppercasing to make it fit would produce a symbol that scans
 * as a DIFFERENT station, because barcodes here are case-sensitive.
 */

function Label({ device, siteName }: { device: DeviceView; siteName: string | null }) {
  const symbol = code39Svg(device.barcode, { narrow: 2, height: 44 });
  const refusal = symbol === null ? code39Refusal(device.barcode) : null;

  return (
    <li
      className="flex break-inside-avoid flex-col justify-between rounded-md border border-line p-3"
      data-testid="station-label"
    >
      <span className="block text-sm font-medium text-foreground">{device.label}</span>
      <span className="block text-xs text-muted">
        {siteName ?? "site"} · {device.deviceType.replace(/_/g, " ")}
      </span>

      {symbol === null ? (
        <span
          className="mt-2 block rounded border border-dashed border-line px-2 py-3 text-[11px] text-faint"
          data-testid="station-label-refusal"
        >
          {refusal}
        </span>
      ) : (
        <svg
          className="mt-2 h-11 w-full"
          viewBox={`0 0 ${symbol.width} ${symbol.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Code 39 barcode for ${device.barcode}`}
          data-testid="station-label-symbol"
        >
          <rect width={symbol.width} height={symbol.height} fill="#fff" />
          <path d={symbol.path} fill="#000" />
        </svg>
      )}

      <span className="mt-1 block text-center font-mono text-xs tracking-wider text-foreground">
        {device.barcode}
      </span>
    </li>
  );
}

export function StationLabels({
  devices,
  siteName,
}: {
  devices: DeviceView[];
  siteName: (propertyId: string) => string | null;
}) {
  const [open, setOpen] = useState(false);

  const printable = useMemo(
    () => devices.filter((device) => device.status !== "removed"),
    [devices],
  );
  const unprintable = useMemo(
    () => printable.filter((device) => code39Svg(device.barcode) === null).length,
    [printable],
  );

  if (printable.length === 0) return null;

  return (
    <div className="mt-4" data-testid="station-labels">
      <button
        type="button"
        className="btn btn-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs print:hidden"
        onClick={() => setOpen((current) => !current)}
      >
        <Printer className="size-3.5" aria-hidden="true" />
        {open ? "Close labels" : `Station labels (${printable.length})`}
      </button>

      {open ? (
        <div className="mt-3">
          <div className="print:hidden">
            <SectionTitle
              title="Station labels"
              description="One label per station, ready for the printer. Code 39, which every handheld reads."
            />
            {unprintable > 0 ? (
              <div className="mt-3">
                <Notice tone="warning">
                  {unprintable} of these {printable.length} stations carry a barcode Code 39
                  cannot encode, so they print without a symbol and say why. Barcodes are
                  case-sensitive here, so an uppercased symbol would scan as a different station.
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
            {printable.map((device) => (
              <Label key={device.id} device={device} siteName={siteName(device.propertyId)} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
