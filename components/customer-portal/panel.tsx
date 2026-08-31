"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * What a customer sees.
 *
 * Everything on this page comes from the SECURITY DEFINER functions that
 * resolve the signed-in caller to exactly one account. There is no account
 * selector, no id in a URL and no filter the customer can widen — the
 * server does not accept one, because the answer to "whose data" is never
 * theirs to give.
 *
 * Two controls are deliberately absent rather than decorative. Paying an
 * invoice needs a card processor and downloading a document needs object
 * storage; neither is connected to this project, so both are labelled
 * **Not Connected** instead of rendering a button that would do nothing.
 */

type Summary = {
  accountName: string;
  accountStatus: string;
  openInvoices: number;
  balanceCents: number;
  nextVisitOn: string | null;
  openRequests: number;
};

type Invoice = {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issuedOn: string | null;
  dueOn: string | null;
  overdue: boolean;
};

type Visit = {
  id: string;
  serviceType: string;
  status: string;
  scheduledStart: string | null;
  completedAt: string | null;
  propertyLabel: string | null;
  completionNotes: string | null;
};

type PortalDocument = {
  id: string;
  title: string;
  kind: string;
  storagePath: string;
  contentType: string | null;
  byteSize: number | null;
  uploadedAt: string;
};

type Request = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  detail: string | null;
  preferredDate: string | null;
  response: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  open: boolean;
  answered: boolean;
};

type Site = {
  id: string;
  label: string;
  address: string;
  propertyType: string | null;
  activeDevices: number;
  openSightings: number;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
};

type Station = {
  id: string;
  propertyId: string;
  propertyLabel: string;
  label: string;
  barcode: string;
  deviceType: string;
  status: string;
  locationNote: string | null;
  activityThreshold: number | null;
  installedAt: string;
  lastServiceAt: string | null;
  lastCondition: string | null;
  lastActivityCount: number | null;
  lastPestObserved: string | null;
  overThreshold: boolean | null;
  everScanned: boolean;
  counted: boolean;
};

type TrendCell = {
  month: string;
  deviceType: string;
  scans: number;
  scansWithCount: number;
  activityTotal: number | null;
  stationsFlagged: number;
};

type Condition = {
  kind: string;
  sourceId: string;
  propertyId: string;
  propertyLabel: string;
  headline: string;
  detail: string | null;
  severity: string;
  observedAt: string;
  reportedByCustomer: boolean;
};

type SafetyProduct = {
  productId: string;
  name: string;
  epaRegistrationNumber: string | null;
  activeIngredient: string | null;
  signalWord: string | null;
  restrictedUse: boolean;
  sdsUrl: string | null;
  labelUrl: string | null;
  applications: number;
  lastAppliedAt: string | null;
};

type Inspection = {
  id: string;
  templateName: string;
  templateKind: string;
  propertyId: string | null;
  propertyLabel: string | null;
  completedAt: string;
  signedByName: string | null;
  signedAt: string | null;
  hasSignature: boolean;
  notes: string | null;
};

type Tab =
  | "overview"
  | "conditions"
  | "stations"
  | "compliance"
  | "invoices"
  | "visits"
  | "documents"
  | "requests";

const REQUEST_KINDS = ["service", "reschedule", "question", "complaint", "cancel", "quote"] as const;

const STATUS_TONES: Record<string, string> = {
  open: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  void: "border-slate-200 bg-slate-100 text-slate-500",
  uncollectible: "border-rose-200 bg-rose-50 text-rose-700",
  submitted: "border-amber-200 bg-amber-50 text-amber-700",
  acknowledged: "border-sky-200 bg-sky-50 text-sky-700",
  scheduled: "border-violet-200 bg-violet-50 text-violet-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-slate-200 bg-slate-100 text-slate-500",
};

const SEVERITY_TONES: Record<string, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  moderate: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-sky-200 bg-sky-50 text-sky-700",
};

const SIGHTING_SEVERITIES = ["low", "moderate", "high"] as const;

const DEVICE_TYPE_LABELS: Record<string, string> = {
  bait_station: "Bait station",
  snap_trap: "Snap trap",
  multi_catch: "Multi-catch",
  insect_light_trap: "Insect light trap",
  pheromone_trap: "Pheromone trap",
  other: "Other",
};

/**
 * How a station reads on the floor, in the page's own words. This mirrors
 * `stationStanding` in lib/services/crm.ts deliberately: the wording here
 * is what a customer sees, and "unknown" must never be drawn the same as
 * "clear". A station nobody scanned is not a clean station.
 */
function standingOf(station: Station): "flagged" | "clear" | "unknown" {
  if (station.lastCondition === "damaged" || station.lastCondition === "missing") return "flagged";
  if (station.lastCondition === "needs_service") return "flagged";
  if (station.overThreshold === true) return "flagged";
  if (!station.everScanned) return "unknown";
  return station.overThreshold === null ? "unknown" : "clear";
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CustomerPortalPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [trend, setTrend] = useState<TrendCell[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [products, setProducts] = useState<SafetyProduct[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [siteFilter, setSiteFilter] = useState<string>("");
  const [noAccess, setNoAccess] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const [kind, setKind] = useState<(typeof REQUEST_KINDS)[number]>("service");
  const [summaryText, setSummaryText] = useState("");
  const [detail, setDetail] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [sending, setSending] = useState(false);

  const [sightingSite, setSightingSite] = useState("");
  const [sightingPest, setSightingPest] = useState("");
  const [sightingSeverity, setSightingSeverity] =
    useState<(typeof SIGHTING_SEVERITIES)[number]>("moderate");
  const [sightingWhere, setSightingWhere] = useState("");
  const [reporting, setReporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/customer-portal", { headers: { accept: "application/json" } });
      if (response.status === 403) {
        setNoAccess(true);
        setSummary(null);
        return;
      }
      const body = (await response.json()) as { summary?: Summary; error?: { message?: string } };
      if (!response.ok) {
        setLoadError(body.error?.message ?? "Your account could not be loaded.");
        return;
      }
      setNoAccess(false);
      setLoadError(null);
      setSummary(body.summary ?? null);

      const stationQuery =
        siteFilter.length === 0 ? "" : `?propertyId=${encodeURIComponent(siteFilter)}`;
      const [
        invoicesRes,
        visitsRes,
        documentsRes,
        requestsRes,
        sitesRes,
        stationsRes,
        conditionsRes,
        complianceRes,
      ] = await Promise.all([
        fetch("/api/customer-portal/invoices", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/visits", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/documents", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/requests", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/sites", { headers: { accept: "application/json" } }),
        fetch(`/api/customer-portal/stations${stationQuery}`, {
          headers: { accept: "application/json" },
        }),
        fetch("/api/customer-portal/conditions", { headers: { accept: "application/json" } }),
        fetch("/api/customer-portal/compliance", { headers: { accept: "application/json" } }),
      ]);
      if (invoicesRes.ok) setInvoices(((await invoicesRes.json()) as { invoices: Invoice[] }).invoices);
      if (visitsRes.ok) setVisits(((await visitsRes.json()) as { visits: Visit[] }).visits);
      if (documentsRes.ok)
        setDocuments(((await documentsRes.json()) as { documents: PortalDocument[] }).documents);
      if (requestsRes.ok) setRequests(((await requestsRes.json()) as { requests: Request[] }).requests);
      if (sitesRes.ok) setSites(((await sitesRes.json()) as { sites: Site[] }).sites);
      if (stationsRes.ok) {
        const body = (await stationsRes.json()) as { stations: Station[]; trend: TrendCell[] };
        setStations(body.stations);
        setTrend(body.trend);
      }
      if (conditionsRes.ok)
        setConditions(((await conditionsRes.json()) as { conditions: Condition[] }).conditions);
      if (complianceRes.ok) {
        const body = (await complianceRes.json()) as {
          products: SafetyProduct[];
          inspections: Inspection[];
        };
        setProducts(body.products);
        setInspections(body.inspections);
      }
    } catch {
      setLoadError("Your account could not be loaded.");
    }
  }, [siteFilter]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const accept = useCallback(async () => {
    setClaiming(true);
    setActionError(null);
    try {
      const response = await fetch("/api/customer-portal/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "The invitation could not be accepted.");
        return;
      }
      await refresh();
    } catch {
      setActionError("The invitation could not be accepted.");
    } finally {
      setClaiming(false);
    }
  }, [refresh]);

  const send = useCallback(async () => {
    setSending(true);
    setActionError(null);
    try {
      const response = await fetch("/api/customer-portal/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          summary: summaryText.trim(),
          detail: detail.trim().length === 0 ? null : detail.trim(),
          preferredDate: preferredDate.length === 0 ? null : preferredDate,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "Your request could not be sent.");
        return;
      }
      setSummaryText("");
      setDetail("");
      setPreferredDate("");
      await refresh();
    } catch {
      setActionError("Your request could not be sent.");
    } finally {
      setSending(false);
    }
  }, [detail, kind, preferredDate, refresh, summaryText]);

  const report = useCallback(async () => {
    setReporting(true);
    setActionError(null);
    try {
      const response = await fetch("/api/customer-portal/conditions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId: sightingSite,
          pest: sightingPest.trim(),
          severity: sightingSeverity,
          locationNote: sightingWhere.trim().length === 0 ? null : sightingWhere.trim(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setActionError(body.error?.message ?? "Your sighting could not be recorded.");
        return;
      }
      setSightingPest("");
      setSightingWhere("");
      await refresh();
    } catch {
      setActionError("Your sighting could not be recorded.");
    } finally {
      setReporting(false);
    }
  }, [refresh, sightingPest, sightingSeverity, sightingSite, sightingWhere]);

  if (noAccess) {
    return (
      <div>
        <PageHeader
          title="Your Service"
          description="This page is for customers who have been invited to the portal by their pest-control company."
        />
        {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}
        <Card>
          <SectionTitle
            title="Accept your invitation"
            description="If your company invited the address you are signed in with, this turns that invitation into a login. Nothing else can — an invitation is matched to your own verified address, never assigned to you."
          />
          <button
            type="button"
            disabled={claiming}
            onClick={() => void accept()}
            className="btn btn-primary mt-4 px-4 py-2 text-sm"
            data-testid="customer-portal-accept"
          >
            {claiming ? "Checking…" : "Accept my invitation"}
          </button>
          <p className="mt-3 text-sm text-muted">
            No invitation for this address? Ask your service company to send one to the address you
            signed in with.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={summary === null ? "Your Service" : summary.accountName}
        description="Your invoices, your visits, your paperwork, and a way to ask for something without calling the office."
      />

      {loadError !== null ? <Notice tone="warning">{loadError}</Notice> : null}
      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="customer-portal-figures">
          <Figure label="Balance" value={summary === null ? "—" : money(summary.balanceCents)} tone={(summary?.balanceCents ?? 0) > 0 ? "amber" : undefined} />
          <Figure label="Open invoices" value={summary === null ? "—" : String(summary.openInvoices)} />
          <Figure
            label="Next visit"
            /* Null when nothing is booked. Saying "none scheduled" is the
             * honest answer; a placeholder date would imply somebody is
             * coming when nobody is. */
            value={summary === null ? "—" : (summary.nextVisitOn ?? "none scheduled")}
          />
          <Figure label="Open requests" value={summary === null ? "—" : String(summary.openRequests)} />
        </dl>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Your service">
        {(
          [
            ["overview", "Overview", undefined],
            ["conditions", "Open conditions", conditions.length],
            ["stations", "Stations", stations.length],
            ["compliance", "Compliance", products.length + inspections.length],
            ["invoices", "Invoices", invoices.length],
            ["visits", "Visits", visits.length],
            ["documents", "Documents", documents.length],
            ["requests", "Requests", requests.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("btn px-3 py-2 text-sm", tab === key ? "btn-primary" : "btn-secondary")}
          >
            {label}
            {typeof count === "number" ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <Card>
          <SectionTitle
            title="Where things stand"
            description="Everything here is your account and nothing else. The server resolves who you are; it does not take an account from the page."
          />
          <p className="mt-4 text-sm text-muted">
            {summary === null
              ? "Loading your account…"
              : `Your account is ${summary.accountStatus}. ${
                  summary.openInvoices === 0
                    ? "Nothing is outstanding."
                    : `${summary.openInvoices} invoice${summary.openInvoices === 1 ? "" : "s"} open, ${money(summary.balanceCents)} in total.`
                } ${summary.nextVisitOn === null ? "No visit is scheduled — ask for one on the Requests tab." : `Your next visit is ${summary.nextVisitOn}.`}`}
          </p>
        </Card>
      ) : null}

      {tab === "conditions" ? (
        <>
          <Card className="mb-6">
            <SectionTitle
              title="Open right now"
              description="Sightings nobody has corrected yet, and stations whose last scan came back wrong. A condition leaves this list when the company records what closed it."
            />
            {conditions.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-conditions-empty">
                Nothing is open. Every sighting on your account has a correction recorded against it,
                and no station failed its last scan.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-conditions-list">
                {conditions.map((condition) => (
                  <li key={`${condition.kind}-${condition.sourceId}`} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{condition.headline}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          SEVERITY_TONES[condition.severity] ?? SEVERITY_TONES.moderate,
                        )}
                      >
                        {condition.severity}
                      </span>
                      <span className="text-xs text-faint">
                        {condition.kind === "sighting" ? "Sighting" : "Station"} · {condition.propertyLabel}
                      </span>
                      <span className="text-xs text-faint">{condition.observedAt.slice(0, 10)}</span>
                      {condition.reportedByCustomer ? (
                        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                          you reported this
                        </span>
                      ) : null}
                    </div>
                    {condition.detail === null ? null : (
                      <p className="mt-1 text-sm text-muted">{condition.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="Report a sighting"
              description="It lands on your company's list immediately and appears above straight away. Your name is on it, so the branch knows who to call back."
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Site</span>
                <select
                  value={sightingSite}
                  onChange={(event) => setSightingSite(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                  data-testid="customer-portal-sighting-site"
                >
                  <option value="">Choose a site…</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">What you saw</span>
                <input
                  value={sightingPest}
                  onChange={(event) => setSightingPest(event.target.value)}
                  maxLength={120}
                  placeholder="German cockroach"
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                  data-testid="customer-portal-sighting-pest"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">How bad</span>
                <select
                  value={sightingSeverity}
                  onChange={(event) =>
                    setSightingSeverity(event.target.value as (typeof SIGHTING_SEVERITIES)[number])
                  }
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                >
                  {SIGHTING_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Where, exactly</span>
                <input
                  value={sightingWhere}
                  onChange={(event) => setSightingWhere(event.target.value)}
                  maxLength={300}
                  placeholder="Prep line floor drain"
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={reporting || sightingSite.length === 0 || sightingPest.trim().length === 0}
              onClick={() => void report()}
              className="btn btn-primary mt-4 px-4 py-2 text-sm"
              data-testid="customer-portal-report-sighting"
            >
              {reporting ? "Recording…" : "Report it"}
            </button>
          </Card>
        </>
      ) : null}

      {tab === "stations" ? (
        <>
          <Card className="mb-6">
            <SectionTitle
              title="Your sites"
              description="Choose one to narrow the stations and the trend below."
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSiteFilter("")}
                className={cn("btn px-3 py-2 text-sm", siteFilter === "" ? "btn-primary" : "btn-secondary")}
              >
                All sites
              </button>
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => setSiteFilter(site.id)}
                  className={cn(
                    "btn px-3 py-2 text-sm",
                    siteFilter === site.id ? "btn-primary" : "btn-secondary",
                  )}
                >
                  {site.label}
                  <span className="ml-1.5 text-xs opacity-70">{site.activeDevices}</span>
                </button>
              ))}
            </div>
            {sites.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-sites-empty">
                No sites are recorded on your account yet.
              </p>
            ) : null}
          </Card>

          <Card className="mb-6">
            <SectionTitle
              title="Stations"
              description="Each row is a station on your floor. The barcode is the sticker on the box, so you can match a row to the wall. Everything shown comes from the technician's scan history, not a summary."
            />
            {stations.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-stations-empty">
                No stations are recorded for this selection.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="customer-portal-stations-table">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                      <th className="py-2 pr-3 font-medium">Station</th>
                      <th className="py-2 pr-3 font-medium">Site</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Last scan</th>
                      <th className="py-2 pr-3 font-medium">Activity</th>
                      <th className="py-2 font-medium">Standing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stations.map((station) => {
                      const standing = standingOf(station);
                      return (
                        <tr key={station.id} className="border-b border-line/60">
                          <td className="py-2 pr-3">
                            <span className="text-foreground">{station.label}</span>
                            <span className="ml-2 text-xs text-faint">{station.barcode}</span>
                            {station.locationNote === null ? null : (
                              <span className="block text-xs text-faint">{station.locationNote}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-muted">{station.propertyLabel}</td>
                          <td className="py-2 pr-3 text-muted">
                            {DEVICE_TYPE_LABELS[station.deviceType] ?? station.deviceType}
                          </td>
                          <td className="py-2 pr-3 text-muted">
                            {/* Never scanned is not a date, and not a zero. */}
                            {station.lastServiceAt === null ? "never" : station.lastServiceAt.slice(0, 10)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-muted">
                            {station.lastActivityCount === null ? (
                              <span className="text-faint">not counted</span>
                            ) : (
                              <>
                                {station.lastActivityCount}
                                {station.activityThreshold === null ? (
                                  <span className="ml-1 text-xs text-faint">no threshold set</span>
                                ) : (
                                  <span className="ml-1 text-xs text-faint">
                                    of {station.activityThreshold}
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="py-2">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                standing === "flagged"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : standing === "clear"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 bg-slate-100 text-slate-600",
                              )}
                            >
                              {standing === "unknown" ? "not established" : standing}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="Activity by month"
              description="One row per month per station type. The scan count sits beside the activity on purpose: a month with no activity and a month nobody scanned are different facts, and this grid will not let them look the same."
            />
            {trend.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-trend-empty">
                No service scans have been recorded for this selection yet.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="customer-portal-trend-table">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                      <th className="py-2 pr-3 font-medium">Month</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Scans</th>
                      <th className="py-2 pr-3 font-medium">Counted</th>
                      <th className="py-2 pr-3 font-medium">Activity</th>
                      <th className="py-2 font-medium">Stations over threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((cell) => (
                      <tr key={`${cell.month}-${cell.deviceType}`} className="border-b border-line/60">
                        <td className="py-2 pr-3 text-foreground">{cell.month.slice(0, 7)}</td>
                        <td className="py-2 pr-3 text-muted">
                          {DEVICE_TYPE_LABELS[cell.deviceType] ?? cell.deviceType}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-muted">{cell.scans}</td>
                        <td className="py-2 pr-3 tabular-nums text-muted">{cell.scansWithCount}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {cell.activityTotal === null ? (
                            <span className="text-faint">nothing counted</span>
                          ) : (
                            <span className="text-foreground">{cell.activityTotal}</span>
                          )}
                        </td>
                        <td className="py-2 tabular-nums text-muted">{cell.stationsFlagged}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {tab === "compliance" ? (
        <>
          <Card className="mb-6">
            <SectionTitle
              title="What has been applied here"
              description="Only products actually used at your own sites — not everything your company stocks. The safety data sheet and label are the manufacturer's published documents."
            />
            {products.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-safety-empty">
                Nothing has been applied at your sites yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-safety-list">
                {products.map((product) => (
                  <li key={product.productId} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{product.name}</span>
                      {product.epaRegistrationNumber === null ? null : (
                        <span className="text-xs text-faint">EPA {product.epaRegistrationNumber}</span>
                      )}
                      {product.signalWord === null ? null : (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          {product.signalWord}
                        </span>
                      )}
                      {product.restrictedUse ? (
                        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                          restricted use
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-faint">
                      {product.activeIngredient === null
                        ? "Active ingredient not recorded."
                        : `Active ingredient: ${product.activeIngredient}.`}{" "}
                      {product.applications} application{product.applications === 1 ? "" : "s"} at your
                      sites
                      {product.lastAppliedAt === null
                        ? "."
                        : `, most recently ${product.lastAppliedAt.slice(0, 10)}.`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      {product.sdsUrl === null ? (
                        /* No sheet on file. Saying so is the point of the
                         * library; a dead link would be worse than nothing. */
                        <span className="text-faint">Safety data sheet not on file</span>
                      ) : (
                        <a
                          href={product.sdsUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-violet-700 underline"
                        >
                          Safety data sheet
                        </a>
                      )}
                      {product.labelUrl === null ? (
                        <span className="text-faint">Label not on file</span>
                      ) : (
                        <a
                          href={product.labelUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-violet-700 underline"
                        >
                          Product label
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="Inspection history"
              description="Completed inspections only. One that has been assigned but not performed has nothing to report, and is not listed."
            />
            {inspections.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-inspections-empty">
                No completed inspections are on record for your account.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-inspections-list">
                {inspections.map((inspection) => (
                  <li key={inspection.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {inspection.templateName}
                      </span>
                      <span className="text-xs text-faint">
                        {inspection.propertyLabel ?? "Account-wide"} ·{" "}
                        {inspection.completedAt.slice(0, 10)}
                      </span>
                      {inspection.hasSignature ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          signed{inspection.signedByName === null ? "" : ` by ${inspection.signedByName}`}
                        </span>
                      ) : (
                        <span className="text-xs text-faint">no signature recorded</span>
                      )}
                    </div>
                    {inspection.notes === null ? null : (
                      <p className="mt-1 text-sm text-muted">{inspection.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Notice tone="info">
              Downloading a signed copy is <strong>Not Connected</strong> — no object storage is
              configured for this workspace, so the portal reports that a signature exists rather than
              offering a file it cannot produce.
            </Notice>
          </Card>
        </>
      ) : null}

      {tab === "invoices" ? (
        <Card>
          <SectionTitle
            title="Invoices"
            description="Issued invoices only. A draft has not been sent to anybody, so it is not here."
          />
          <Notice tone="info">
            Paying online is <strong>Not Connected</strong> — no card processor is configured for this
            workspace. Balances are accurate; settle them the way you do today.
          </Notice>
          {invoices.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="customer-portal-invoices-empty">
              No invoices yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="customer-portal-invoices-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Issued</th>
                    <th className="py-2 pr-3 font-medium">Due</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Balance</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="py-2.5 pr-3 text-foreground">{invoice.number}</td>
                      <td className="py-2.5 pr-3 text-muted">{invoice.issuedOn ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {invoice.dueOn ?? "—"}
                        {invoice.overdue ? <span className="ml-1 text-rose-700">overdue</span> : null}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{money(invoice.totalCents)}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-foreground">{money(invoice.balanceCents)}</td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            STATUS_TONES[invoice.status] ?? STATUS_TONES.open,
                          )}
                        >
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "visits" ? (
        <Card>
          <SectionTitle
            title="Visits"
            description="What has been done at your sites, and what is booked. The note is the one your technician wrote for you."
          />
          {visits.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="customer-portal-visits-empty">
              No visits recorded yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="customer-portal-visits-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Service</th>
                    <th className="py-2 pr-3 font-medium">Site</th>
                    <th className="py-2 pr-3 font-medium">Scheduled</th>
                    <th className="py-2 pr-3 font-medium">Completed</th>
                    <th className="py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visits.map((visit) => (
                    <tr key={visit.id}>
                      <td className="py-2.5 pr-3 text-foreground">{visit.serviceType}</td>
                      <td className="py-2.5 pr-3 text-muted">{visit.propertyLabel ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {visit.scheduledStart === null ? "—" : visit.scheduledStart.slice(0, 10)}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {visit.completedAt === null ? "—" : visit.completedAt.slice(0, 10)}
                      </td>
                      <td className="py-2.5 text-muted">{visit.completionNotes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "documents" ? (
        <Card>
          <SectionTitle
            title="Documents"
            description="Your agreements, reports and permits. Internal photographs and staff notes are not in this list."
          />
          <Notice tone="info">
            Downloading is <strong>Not Connected</strong> — no document storage is configured for this
            workspace, so these are listed rather than opened.
          </Notice>
          {documents.length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="customer-portal-documents-empty">
              Nothing filed yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-documents-list">
              {documents.map((document) => (
                <li key={document.id} className="py-2.5">
                  <span className="text-sm text-foreground">{document.title}</span>
                  <span className="ml-2 text-xs text-faint">
                    {document.kind.replace(/_/g, " ")} · {document.uploadedAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "requests" ? (
        <>
          <Card className="mb-6">
            <SectionTitle
              title="Ask for something"
              description="What you write here goes to your service company as you wrote it. Their reply appears beside it — it never replaces your words."
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Kind</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as (typeof REQUEST_KINDS)[number])}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                >
                  {REQUEST_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
                  Preferred date (optional)
                </span>
                <input
                  type="date"
                  value={preferredDate}
                  onChange={(event) => setPreferredDate(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">In one line</span>
                <input
                  value={summaryText}
                  onChange={(event) => setSummaryText(event.target.value)}
                  maxLength={200}
                  placeholder="Ants along the back wall again"
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
                  Anything else (optional)
                </span>
                <textarea
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={sending || summaryText.trim().length === 0}
              onClick={() => void send()}
              className="btn btn-primary mt-4 px-4 py-2 text-sm"
              data-testid="customer-portal-send-request"
            >
              {sending ? "Sending…" : "Send it"}
            </button>
          </Card>

          <Card>
            <SectionTitle title="What you have asked for" description="Yours only, newest first." />
            {requests.length === 0 ? (
              <p className="mt-4 text-sm text-muted" data-testid="customer-portal-requests-empty">
                You have not sent anything yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line" data-testid="customer-portal-requests-list">
                {requests.map((request) => (
                  <li key={request.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-foreground">{request.summary}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          STATUS_TONES[request.status] ?? STATUS_TONES.submitted,
                        )}
                      >
                        {request.status}
                      </span>
                      <span className="text-xs text-faint">{request.submittedAt.slice(0, 10)}</span>
                    </div>
                    {request.detail === null ? null : (
                      <p className="mt-1 text-sm text-muted">{request.detail}</p>
                    )}
                    {request.response === null ? (
                      request.open ? (
                        <p className="mt-1 text-xs text-faint">Waiting on a reply.</p>
                      ) : null
                    ) : (
                      <p className="mt-1 rounded-lg bg-slate-50 p-2 text-sm text-foreground">
                        {request.response}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-faint">
        <Receipt className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
