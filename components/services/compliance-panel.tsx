"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FlaskConical, ShieldCheck } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { useAccountProperties } from "@/components/services/use-account-properties";
import type {
  StockPayload,
  AccountsPayload,
  ApplicationsPayload,
  ComplianceReportPayload,
  ComplianceRulesPayload,
  ProductsPayload,
  TechniciansPayload,
} from "@/components/services/types";

/**
 * Chemicals and compliance: the catalogue a workspace is licensed to
 * apply, the lots on the shelf, the append-only application log, the
 * jurisdiction rules that decide what a record must contain, and the
 * audit-ready report an inspector reads. Every figure is a live row; the
 * CSV downloads the same rows the table shows.
 */

const METHODS = [
  "bait",
  "crack_and_crevice",
  "spot",
  "perimeter",
  "broadcast",
  "void",
  "dust",
  "fumigation",
  "other",
] as const;
const UNITS = ["oz", "fl_oz", "lb", "g", "kg", "ml", "l", "gal", "each"] as const;
const SIGNAL_WORDS = ["CAUTION", "WARNING", "DANGER"] as const;

export function ServicesCompliancePanel() {
  const [catalogue, setCatalogue] = useState<ProductsPayload | null>(null);
  const [applications, setApplications] = useState<ApplicationsPayload | null>(null);
  const [rules, setRules] = useState<ComplianceRulesPayload | null>(null);
  const [accounts, setAccounts] = useState<AccountsPayload | null>(null);
  const [technicians, setTechnicians] = useState<TechniciansPayload | null>(null);
  const [stock, setStock] = useState<StockPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<"product" | "application" | "rule" | null>(null);

  const [report, setReport] = useState<ComplianceReportPayload | null>(null);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportAccount, setReportAccount] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [productsRes, applicationsRes, rulesRes, accountsRes, techniciansRes, stockRes] =
        await Promise.all([
          fetch("/api/services/products", { headers: { accept: "application/json" } }),
          fetch("/api/services/applications", { headers: { accept: "application/json" } }),
          fetch("/api/services/compliance/rules", { headers: { accept: "application/json" } }),
          fetch("/api/services/accounts", { headers: { accept: "application/json" } }),
          fetch("/api/services/technicians", { headers: { accept: "application/json" } }),
          fetch("/api/services/stock", { headers: { accept: "application/json" } }),
        ]);
      const productsBody = (await productsRes.json()) as ProductsPayload & {
        error?: { message?: string };
      };
      if (!productsRes.ok) {
        setListError(productsBody.error?.message ?? "The chemical catalogue could not be read.");
        return;
      }
      setListError(null);
      setCatalogue(productsBody);
      if (applicationsRes.ok) setApplications((await applicationsRes.json()) as ApplicationsPayload);
      if (rulesRes.ok) setRules((await rulesRes.json()) as ComplianceRulesPayload);
      if (accountsRes.ok) setAccounts((await accountsRes.json()) as AccountsPayload);
      if (techniciansRes.ok) setTechnicians((await techniciansRes.json()) as TechniciansPayload);
      if (stockRes.ok) setStock((await stockRes.json()) as StockPayload);
    } catch {
      setListError("The chemical catalogue could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const reportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (reportFrom !== "") params.set("from", reportFrom);
    if (reportTo !== "") params.set("to", reportTo);
    if (reportAccount !== "") params.set("accountId", reportAccount);
    return params;
  }, [reportFrom, reportTo, reportAccount]);

  const runReport = useCallback(async () => {
    setActError(null);
    try {
      const params = reportParams();
      const suffix = params.toString();
      const response = await fetch(`/api/services/compliance/report${suffix ? `?${suffix}` : ""}`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActError(body.error?.message ?? "The report could not be built.");
        return;
      }
      setReport((await response.json()) as ComplianceReportPayload);
    } catch {
      setActError("The request did not reach the server.");
    }
  }, [reportParams]);

  const productName = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of catalogue?.products ?? []) map.set(product.id, product.name);
    return map;
  }, [catalogue]);

  const technicianName = useMemo(() => {
    const map = new Map<string, string>();
    for (const technician of technicians?.technicians ?? []) {
      map.set(technician.id, `${technician.firstName} ${technician.lastName ?? ""}`.trim());
    }
    return map;
  }, [technicians]);

  /**

   * Where each lot's remainder physically sits (ADR-213). Derived from the

   * movement ledger, so it is what was put there minus what left rather

   * than a number somebody typed.

   */

  const stockByLot = useMemo(() => {

    const map = new Map<string, { locationLabel: string; quantity: number }[]>();

    for (const balance of stock?.balances ?? []) {

      const bucket = map.get(balance.lotId) ?? [];

      bucket.push({ locationLabel: balance.locationLabel, quantity: balance.quantity });

      map.set(balance.lotId, bucket);

    }

    return map;

  }, [stock]);


  const lotsByProduct = useMemo(() => {
    const map = new Map<string, typeof catalogue extends null ? never : NonNullable<typeof catalogue>["lots"]>();
    for (const lot of catalogue?.lots ?? []) {
      const list = map.get(lot.productId) ?? [];
      list.push(lot);
      map.set(lot.productId, list);
    }
    return map;
  }, [catalogue]);

  const csvHref = useMemo(() => {
    const params = reportParams();
    params.set("format", "csv");
    return `/api/services/compliance/report?${params.toString()}`;
  }, [reportParams]);

  return (
    <div>
      <PageHeader
        title="Chemicals & Compliance"
        description="The catalogue you are licensed to apply, the lots on the shelf, the append-only application log, and audit-ready reports by customer, site, date, product or technician."
        action={
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOpenForm((c) => (c === "application" ? null : "application"))}
              className="btn btn-primary px-3 py-2 text-sm"
            >
              {openForm === "application" ? "Close" : "Record application"}
            </button>
            <button
              type="button"
              onClick={() => setOpenForm((c) => (c === "product" ? null : "product"))}
              className="btn btn-secondary px-3 py-2 text-sm"
            >
              {openForm === "product" ? "Close" : "Add product"}
            </button>
            <button
              type="button"
              onClick={() => setOpenForm((c) => (c === "rule" ? null : "rule"))}
              className="btn btn-secondary px-3 py-2 text-sm"
            >
              {openForm === "rule" ? "Close" : "Jurisdiction rule"}
            </button>
          </span>
        }
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      {openForm === "product" ? (
        <ProductForm onDone={() => { setOpenForm(null); void refresh(); }} />
      ) : null}
      {openForm === "rule" ? (
        <RuleForm onDone={() => { setOpenForm(null); void refresh(); }} />
      ) : null}
      {openForm === "application" ? (
        <ApplicationForm
          accounts={accounts}
          catalogue={catalogue}
          technicians={technicians}
          rules={rules}
          onDone={() => { setOpenForm(null); void refresh(); }}
        />
      ) : null}

      <Card className="mb-6">
        <SectionTitle
          title="Audit-ready service report"
          description="Every application in the window, resolved into the names an inspector reads. The CSV downloads exactly these rows."
        />
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1.5fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void runReport();
          }}
        >
          <label className="block text-sm">
            <span className="text-muted">From</span>
            <input
              type="date"
              value={reportFrom}
              onChange={(event) => setReportFrom(event.target.value)}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">To</span>
            <input
              type="date"
              value={reportTo}
              onChange={(event) => setReportTo(event.target.value)}
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Customer</span>
            <select
              value={reportAccount}
              onChange={(event) => setReportAccount(event.target.value)}
              className="input mt-1 w-full"
            >
              <option value="">Every customer</option>
              {(accounts?.accounts ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="btn btn-secondary px-4 py-2 text-sm">
              Run report
            </button>
            <a href={csvHref} className="btn btn-secondary px-3 py-2 text-sm" download>
              <Download className="size-3.5" aria-hidden="true" />
              CSV
            </a>
          </div>
        </form>

        {report !== null ? (
          report.rows.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-report-empty">
              No applications in this window. Record one above, and it appears here and on the
              customer&apos;s timeline in the same transaction.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <p className="mb-2 text-xs text-faint">
                {report.count} {report.count === 1 ? "application" : "applications"}
                {report.truncated ? " (showing the newest 5,000)" : ""}
              </p>
              <table className="w-full text-left text-sm" data-testid="services-report-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Applied</th>
                    <th className="py-2 pr-3 font-medium">Customer / site</th>
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Method</th>
                    <th className="py-2 font-medium">Applicator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.rows.map((row, index) => (
                    <tr key={`${row.applied_at}-${index}`}>
                      <td className="py-2.5 pr-3 text-muted">{row.applied_at.slice(0, 10)}</td>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-foreground">{row.customer ?? "—"}</span>
                        <span className="block text-xs text-faint">{row.site ?? "—"}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="block text-foreground">{row.product ?? "—"}</span>
                        {row.epa_registration_number ? (
                          <span className="block font-mono text-xs text-faint">
                            EPA {row.epa_registration_number}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {row.quantity} {row.unit}
                        {row.application_rate ? (
                          <span className="block text-xs text-faint">{row.application_rate}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{row.method.replace(/_/g, " ")}</td>
                      <td className="py-2.5">
                        <span className="block text-foreground">{row.technician ?? "—"}</span>
                        <span className="block font-mono text-xs text-faint">
                          {row.applicator_license ?? "no license recorded"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title={`Products (${catalogue?.products.length ?? 0})`}
            description="What this workspace is licensed to apply, with SDS and label references."
          />
          {catalogue === null ? (
            <p className="mt-3 text-sm text-muted">Loading the catalogue…</p>
          ) : catalogue.products.length === 0 ? (
            <p className="mt-3 text-sm text-muted" data-testid="services-products-empty">
              No products yet. Add product records the first one — an application must name a
              product, so this is where the compliance trail starts.
            </p>
          ) : (
            <ul className="mt-3 space-y-3" data-testid="services-products">
              {catalogue.products.map((product) => {
                const lots = lotsByProduct.get(product.id) ?? [];
                return (
                  <li key={product.id} className="rounded-lg border border-line bg-surface-inset p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <FlaskConical className="size-4 text-faint" aria-hidden="true" />
                      <span className="font-medium text-foreground">{product.name}</span>
                      {product.restrictedUse ? (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                          restricted use
                        </span>
                      ) : null}
                      {product.signalWord ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {product.signalWord}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {product.epaRegistrationNumber ? `EPA ${product.epaRegistrationNumber}` : "No EPA number"}
                      {product.activeIngredient ? ` · ${product.activeIngredient}` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-3 text-xs">
                      {product.sdsUrl ? (
                        <a
                          href={product.sdsUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2"
                        >
                          SDS
                        </a>
                      ) : (
                        <span className="text-faint">No SDS recorded</span>
                      )}
                      {product.labelUrl ? (
                        <a
                          href={product.labelUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2"
                        >
                          Label
                        </a>
                      ) : (
                        <span className="text-faint">No label recorded</span>
                      )}
                    </p>
                    {lots.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted">
                        {lots.map((lot) => (
                          <li key={lot.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-mono">{lot.lotNumber}</span>
                            <span>
                              {lot.quantityRemaining} of {lot.quantityReceived} {lot.unit} left
                            </span>
                            {lot.expiresOn ? <span>· expires {lot.expiresOn}</span> : null}
                            {lot.quantityRemaining === 0 ? (
                              <span className="rounded-full border border-line px-2 py-0.5 text-[11px]">spent</span>
                            ) : null}
                            {(stockByLot.get(lot.id) ?? []).map((held) => (
                              <span
                                key={held.locationLabel}
                                className="rounded-full border border-line px-2 py-0.5 text-[11px]"
                              >
                                {held.quantity} {lot.unit} · {held.locationLabel}
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-faint">No lots received.</p>
                    )}
                    <LotForm productId={product.id} defaultUnit={product.defaultUnit} onDone={refresh} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle
            title={`Jurisdiction rules (${rules?.rules.length ?? 0})`}
            description="What each place you operate in requires. Configured here, never hardcoded — an application named to a jurisdiction is held to its rule."
          />
          {rules === null ? (
            <p className="mt-3 text-sm text-muted">Loading rules…</p>
          ) : rules.rules.length === 0 ? (
            <p className="mt-3 text-sm text-muted" data-testid="services-rules-empty">
              No jurisdiction rules yet. Jurisdiction rule adds one — record retention and the
              fields your regulator requires on every application.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm" data-testid="services-rules">
              {rules.rules.map((rule) => (
                <li key={rule.id} className="rounded-lg border border-line bg-surface-inset p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="size-4 text-[var(--accent)]" aria-hidden="true" />
                    <span className="font-mono text-xs font-semibold text-foreground">{rule.jurisdiction}</span>
                    <span className="text-foreground">{rule.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Retain {rule.retentionYears} {rule.retentionYears === 1 ? "year" : "years"} · requires{" "}
                    {[
                      rule.requiresApplicatorLicense ? "applicator license" : null,
                      rule.requiresTargetPest ? "target pest" : null,
                      rule.requiresApplicationRate ? "application rate" : null,
                      rule.requiresTreatedArea ? "treated area" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "no extra fields"}
                  </p>
                  {rule.notes ? <p className="mt-1 text-xs text-faint">{rule.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6">
            <SectionTitle
              title={`Recent applications (${applications?.applications.length ?? 0})`}
              description="Append-only: a correction is a new record naming the one it supersedes."
            />
            {applications === null || applications.applications.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm" data-testid="services-applications">
                {applications.applications.slice(0, 10).map((application) => (
                  <li key={application.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs text-faint">{application.appliedAt.slice(0, 10)}</span>
                    <span className="font-medium text-foreground">
                      {productName.get(application.productId) ?? "Product"}
                    </span>
                    <span className="text-muted">
                      {application.quantity} {application.unit} · {application.method.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-faint">
                      {technicianName.get(application.technicianId) ?? "technician"}
                      {application.applicatorLicense ? ` · ${application.applicatorLicense}` : ""}
                    </span>
                    {application.supersedesId ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        correction
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProductForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [epa, setEpa] = useState("");
  const [ingredient, setIngredient] = useState("");
  const [signalWord, setSignalWord] = useState("");
  const [sdsUrl, setSdsUrl] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [defaultUnit, setDefaultUnit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Add a product"
        description="The regulator's identity for a product is its EPA registration number; SDS and label references must be https links."
      />
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void (async () => {
            try {
              const response = await fetch("/api/services/products", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  name: name.trim(),
                  ...(epa.trim() ? { epaRegistrationNumber: epa.trim() } : {}),
                  ...(ingredient.trim() ? { activeIngredient: ingredient.trim() } : {}),
                  ...(signalWord ? { signalWord } : {}),
                  ...(sdsUrl.trim() ? { sdsUrl: sdsUrl.trim() } : {}),
                  ...(labelUrl.trim() ? { labelUrl: labelUrl.trim() } : {}),
                  restrictedUse: restricted,
                  ...(defaultUnit ? { defaultUnit } : {}),
                }),
              });
              const body = (await response.json()) as { product?: unknown; error?: { message?: string } };
              if (!response.ok || !body.product) {
                setError(body.error?.message ?? "The product could not be recorded.");
                return;
              }
              onDone();
            } catch {
              setError("The request did not reach the server.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label className="block text-sm">
          <span className="text-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={200}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">EPA registration number</span>
          <input
            type="text"
            value={epa}
            onChange={(event) => setEpa(event.target.value)}
            maxLength={30}
            placeholder="499-507"
            className="input mt-1 w-full font-mono"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Active ingredient</span>
          <input
            type="text"
            value={ingredient}
            onChange={(event) => setIngredient(event.target.value)}
            maxLength={200}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Signal word</span>
          <select
            value={signalWord}
            onChange={(event) => setSignalWord(event.target.value)}
            className="input mt-1 w-full"
          >
            <option value="">—</option>
            {SIGNAL_WORDS.map((word) => (
              <option key={word} value={word}>
                {word}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Default unit</span>
          <select
            value={defaultUnit}
            onChange={(event) => setDefaultUnit(event.target.value)}
            className="input mt-1 w-full"
          >
            <option value="">—</option>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm sm:mt-6">
          <input
            type="checkbox"
            checked={restricted}
            onChange={(event) => setRestricted(event.target.checked)}
            className="size-4"
          />
          <span className="text-muted">Restricted use</span>
        </label>
        <label className="block text-sm">
          <span className="text-muted">SDS URL</span>
          <input
            type="url"
            value={sdsUrl}
            onChange={(event) => setSdsUrl(event.target.value)}
            maxLength={500}
            placeholder="https://…"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Label URL</span>
          <input
            type="url"
            value={labelUrl}
            onChange={(event) => setLabelUrl(event.target.value)}
            maxLength={500}
            placeholder="https://…"
            className="input mt-1 w-full"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Recording…" : "Add product"}
          </button>
        </div>
      </form>
      {error !== null ? (
        <div className="mt-3">
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function LotForm({
  productId,
  defaultUnit,
  onDone,
}: {
  productId: string;
  defaultUnit: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lotNumber, setLotNumber] = useState("");
  const [unit, setUnit] = useState(defaultUnit ?? "oz");
  const [quantity, setQuantity] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary mt-2 px-2.5 py-1 text-xs"
      >
        Receive lot
      </button>
    );
  }

  return (
    <form
      className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_0.8fr_0.8fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number(quantity);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setError("Quantity must be a positive amount.");
          return;
        }
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const response = await fetch(`/api/services/products/${productId}/lots`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                lotNumber: lotNumber.trim(),
                unit,
                quantityReceived: parsed,
                ...(expires ? { expiresOn: expires } : {}),
              }),
            });
            const body = (await response.json()) as { lot?: unknown; error?: { message?: string } };
            if (!response.ok || !body.lot) {
              setError(body.error?.message ?? "The lot could not be recorded.");
              return;
            }
            setOpen(false);
            setLotNumber("");
            setQuantity("");
            setExpires("");
            onDone();
          } catch {
            setError("The request did not reach the server.");
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <input
        type="text"
        value={lotNumber}
        onChange={(event) => setLotNumber(event.target.value)}
        required
        maxLength={100}
        placeholder="Lot number"
        aria-label="Lot number"
        className="input min-h-8 py-1 text-xs"
      />
      <input
        type="number"
        min={0}
        step="0.001"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
        placeholder="Amount"
        aria-label="Quantity received"
        className="input min-h-8 py-1 text-xs"
      />
      <select
        value={unit}
        onChange={(event) => setUnit(event.target.value)}
        aria-label="Lot unit"
        className="input min-h-8 py-1 text-xs"
      >
        {UNITS.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={expires}
        onChange={(event) => setExpires(event.target.value)}
        aria-label="Expires on"
        className="input min-h-8 py-1 text-xs"
      />
      <button type="submit" disabled={busy} className="btn btn-secondary px-2.5 py-1 text-xs">
        Receive
      </button>
      {error !== null ? (
        <p className="text-xs text-[var(--danger)] sm:col-span-5">{error}</p>
      ) : null}
    </form>
  );
}

function RuleForm({ onDone }: { onDone: () => void }) {
  const [jurisdiction, setJurisdiction] = useState("");
  const [label, setLabel] = useState("");
  const [retention, setRetention] = useState("2");
  const [license, setLicense] = useState(true);
  const [pest, setPest] = useState(false);
  const [rate, setRate] = useState(false);
  const [area, setArea] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Configure a jurisdiction"
        description="Your regulator's requirements, as a record. Applications named to this jurisdiction are refused unless they carry what it requires."
      />
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const years = Number(retention);
          if (!Number.isInteger(years) || years < 1) {
            setError("Retention must be a whole number of years.");
            return;
          }
          setBusy(true);
          setError(null);
          void (async () => {
            try {
              const response = await fetch("/api/services/compliance/rules", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  jurisdiction: jurisdiction.trim().toUpperCase(),
                  label: label.trim(),
                  retentionYears: years,
                  requiresApplicatorLicense: license,
                  requiresTargetPest: pest,
                  requiresApplicationRate: rate,
                  requiresTreatedArea: area,
                }),
              });
              const body = (await response.json()) as { rule?: unknown; error?: { message?: string } };
              if (!response.ok || !body.rule) {
                setError(body.error?.message ?? "The rule could not be recorded.");
                return;
              }
              onDone();
            } catch {
              setError("The request did not reach the server.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label className="block text-sm">
          <span className="text-muted">Jurisdiction code</span>
          <input
            type="text"
            value={jurisdiction}
            onChange={(event) => setJurisdiction(event.target.value)}
            required
            maxLength={13}
            placeholder="US-OR"
            className="input mt-1 w-full font-mono"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Label</span>
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={120}
            placeholder="Oregon Department of Agriculture"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Retention (years)</span>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={retention}
            onChange={(event) => setRetention(event.target.value)}
            required
            className="input mt-1 w-full"
          />
        </label>
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="text-sm text-muted">Required on every application</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {(
              [
                ["Applicator license", license, setLicense],
                ["Target pest", pest, setPest],
                ["Application rate", rate, setRate],
                ["Treated area", area, setArea],
              ] as const
            ).map(([text, value, setter]) => (
              <label key={text} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(event) => setter(event.target.checked)}
                  className="size-4"
                />
                <span className="text-muted">{text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Recording…" : "Configure jurisdiction"}
          </button>
        </div>
      </form>
      {error !== null ? (
        <div className="mt-3">
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function ApplicationForm({
  accounts,
  catalogue,
  technicians,
  rules,
  onDone,
}: {
  accounts: AccountsPayload | null;
  catalogue: ProductsPayload | null;
  technicians: TechniciansPayload | null;
  rules: ComplianceRulesPayload | null;
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [productId, setProductId] = useState("");
  const [lotId, setLotId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("bait");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("oz");
  const [targetPest, setTargetPest] = useState("");
  const [rate, setRate] = useState("");
  const [area, setArea] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const properties = useAccountProperties(accountId);

  const lots = (catalogue?.lots ?? []).filter(
    (lot) => lot.productId === productId && lot.quantityRemaining > 0,
  );

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Record an application"
        description="The legal record: append-only, with the applicator's license copied as it stands today. It lands on the customer's timeline in the same transaction."
      />
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const parsedQuantity = Number(quantity);
          if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
            setError("Quantity must be a positive amount.");
            return;
          }
          setBusy(true);
          setError(null);
          void (async () => {
            try {
              const response = await fetch("/api/services/applications", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  accountId,
                  propertyId,
                  productId,
                  technicianId,
                  ...(lotId ? { lotId } : {}),
                  method,
                  quantity: parsedQuantity,
                  unit,
                  ...(targetPest.trim() ? { targetPest: targetPest.trim() } : {}),
                  ...(rate.trim() ? { applicationRate: rate.trim() } : {}),
                  ...(area.trim() ? { treatedArea: area.trim() } : {}),
                  ...(jurisdiction ? { jurisdiction } : {}),
                }),
              });
              const body = (await response.json()) as {
                application?: unknown;
                error?: { message?: string };
              };
              if (!response.ok || !body.application) {
                setError(body.error?.message ?? "The application could not be recorded.");
                return;
              }
              onDone();
            } catch {
              setError("The request did not reach the server.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label className="block text-sm">
          <span className="text-muted">Account</span>
          <select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              setPropertyId("");
            }}
            required
            className="input mt-1 w-full"
          >
            <option value="" disabled>
              Pick the account…
            </option>
            {(accounts?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Property</span>
          <select
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
            required
            disabled={accountId === ""}
            className="input mt-1 w-full"
          >
            <option value="" disabled>
              {accountId === "" ? "Pick the account first…" : "Pick the property…"}
            </option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Technician</span>
          <select
            value={technicianId}
            onChange={(event) => setTechnicianId(event.target.value)}
            required
            className="input mt-1 w-full"
          >
            <option value="" disabled>
              Pick the applicator…
            </option>
            {(technicians?.technicians ?? []).map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.firstName} {technician.lastName ?? ""}
                {technician.licenseNumber ? ` · ${technician.licenseNumber}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Product</span>
          <select
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setLotId("");
              const product = (catalogue?.products ?? []).find((p) => p.id === event.target.value);
              if (product?.defaultUnit) setUnit(product.defaultUnit as (typeof UNITS)[number]);
            }}
            required
            className="input mt-1 w-full"
          >
            <option value="" disabled>
              Pick the product…
            </option>
            {(catalogue?.products ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Lot (optional)</span>
          <select
            value={lotId}
            onChange={(event) => setLotId(event.target.value)}
            disabled={productId === ""}
            className="input mt-1 w-full"
          >
            <option value="">No lot recorded</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.lotNumber} — {lot.quantityRemaining} {lot.unit} left
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Method</span>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as (typeof METHODS)[number])}
            className="input mt-1 w-full"
          >
            {METHODS.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Quantity</span>
          <input
            type="number"
            min={0}
            step="0.001"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Unit</span>
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as (typeof UNITS)[number])}
            className="input mt-1 w-full"
          >
            {UNITS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Hold to jurisdiction</span>
          <select
            value={jurisdiction}
            onChange={(event) => setJurisdiction(event.target.value)}
            className="input mt-1 w-full"
          >
            <option value="">No jurisdiction check</option>
            {(rules?.rules ?? []).map((rule) => (
              <option key={rule.id} value={rule.jurisdiction}>
                {rule.jurisdiction} — {rule.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Target pest</span>
          <input
            type="text"
            value={targetPest}
            onChange={(event) => setTargetPest(event.target.value)}
            maxLength={120}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Application rate</span>
          <input
            type="text"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            maxLength={200}
            placeholder="0.5 oz per gallon"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Treated area</span>
          <input
            type="text"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            maxLength={300}
            placeholder="Perimeter, 240 linear ft"
            className="input mt-1 w-full"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Recording…" : "Record application"}
          </button>
        </div>
      </form>
      {error !== null ? (
        <div className="mt-3">
          <Notice tone="warning" icon={AlertTriangle}>
            {error}
          </Notice>
        </div>
      ) : null}
    </Card>
  );
}
