"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Radar, ScanLine } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { useAccountProperties } from "@/components/services/use-account-properties";
import { cn } from "@/lib/cn";
import type {
  AccountsPayload,
  DeviceEventView,
  DeviceView,
  IpmPayload,
  SightingView,
} from "@/components/services/types";

/**
 * The IPM command center: every station with its barcode identity and scan
 * history, sightings with their corrective-action loop, and per-site
 * rollups — computed here from the same live rows the tables render, so
 * the summary and its detail can never disagree. A scan is a real append to
 * the ledger; the station's state is updated by the database from it.
 */

const DEVICE_TYPES = [
  "bait_station",
  "snap_trap",
  "multi_catch",
  "insect_light_trap",
  "pheromone_trap",
  "other",
] as const;
const TYPE_LABELS: Record<string, string> = {
  bait_station: "Bait station",
  snap_trap: "Snap trap",
  multi_catch: "Multi-catch",
  insect_light_trap: "Insect light trap",
  pheromone_trap: "Pheromone trap",
  other: "Other",
};
const EVENTS = ["service", "install", "move", "remove"] as const;
const CONDITIONS = ["ok", "needs_service", "damaged", "missing"] as const;
const SEVERITIES = ["low", "moderate", "high"] as const;
const SEVERITY_TONES: Record<string, string> = {
  low: "border-sky-200 bg-sky-50 text-sky-700",
  moderate: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ServicesIpmPanel() {
  const [payload, setPayload] = useState<IpmPayload | null>(null);
  const [accounts, setAccounts] = useState<AccountsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<"device" | "sighting" | null>(null);
  const [resolving, setResolving] = useState<{ id: string; action: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ipmRes, accountsRes] = await Promise.all([
        fetch("/api/services/ipm", { headers: { accept: "application/json" } }),
        fetch("/api/services/accounts", { headers: { accept: "application/json" } }),
      ]);
      const ipmBody = (await ipmRes.json()) as IpmPayload & { error?: { message?: string } };
      if (!ipmRes.ok) {
        setListError(ipmBody.error?.message ?? "The IPM dashboard could not be read.");
        return;
      }
      setListError(null);
      setPayload(ipmBody);
      if (accountsRes.ok) setAccounts((await accountsRes.json()) as AccountsPayload);
    } catch {
      setListError("The IPM dashboard could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const act = useCallback(
    async (url: string, method: string, body: unknown): Promise<boolean> => {
      setActError(null);
      try {
        const response = await fetch(url, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const parsed = (await response.json()) as { error?: { message?: string } };
          setActError(parsed.error?.message ?? "The change could not be recorded.");
          return false;
        }
        setResolving(null);
        void refresh();
        return true;
      } catch {
        setActError("The request did not reach the server.");
        return false;
      }
    },
    [refresh],
  );

  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts?.accounts ?? []) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  /** The newest counted scan per station — the threshold comparison's side. */
  const latestActivity = useMemo(() => {
    const map = new Map<string, DeviceEventView>();
    for (const event of payload?.recentEvents ?? []) {
      if (event.activityCount === null) continue;
      if (!map.has(event.deviceId)) map.set(event.deviceId, event);
    }
    return map;
  }, [payload]);

  const sites = useMemo(() => {
    if (!payload) return [];
    const byProperty = new Map<
      string,
      { devices: DeviceView[]; sightings: SightingView[] }
    >();
    for (const device of payload.devices) {
      const site = byProperty.get(device.propertyId) ?? { devices: [], sightings: [] };
      site.devices.push(device);
      byProperty.set(device.propertyId, site);
    }
    for (const sighting of payload.sightings) {
      const site = byProperty.get(sighting.propertyId) ?? { devices: [], sightings: [] };
      site.sightings.push(sighting);
      byProperty.set(sighting.propertyId, site);
    }
    const labels = new Map(payload.properties.map((property) => [property.id, property]));
    return [...byProperty.entries()].map(([propertyId, site]) => ({
      propertyId,
      label: labels.get(propertyId)?.label ?? "Property",
      accountId: labels.get(propertyId)?.accountId ?? "",
      ...site,
    }));
  }, [payload]);

  const overThresholdCount = useMemo(
    () =>
      (payload?.devices ?? []).filter((device) => {
        const latest = latestActivity.get(device.id);
        return (
          device.status === "active"
          && device.activityThreshold !== null
          && latest !== undefined
          && (latest.activityCount ?? 0) >= device.activityThreshold
        );
      }).length,
    [payload, latestActivity],
  );
  const openSightings = (payload?.sightings ?? []).filter((s) => s.correctedAt === null);

  return (
    <div>
      <PageHeader
        title="IPM & Devices"
        description="Stations with barcode identity, an append-only scan ledger, sightings with their corrective actions, and thresholds that flag what needs attention."
        action={
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpenForm((current) => (current === "device" ? null : "device"))}
              className="btn btn-primary px-3 py-2 text-sm"
            >
              {openForm === "device" ? "Close" : "Install device"}
            </button>
            <button
              type="button"
              onClick={() => setOpenForm((current) => (current === "sighting" ? null : "sighting"))}
              className="btn btn-secondary px-3 py-2 text-sm"
            >
              {openForm === "sighting" ? "Close" : "Log sighting"}
            </button>
          </span>
        }
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      {openForm === "device" ? (
        <DeviceForm accounts={accounts} onDone={() => { setOpenForm(null); void refresh(); }} />
      ) : null}
      {openForm === "sighting" ? (
        <SightingForm accounts={accounts} onDone={() => { setOpenForm(null); void refresh(); }} />
      ) : null}

      {payload !== null ? (
        <div className="mb-6 flex flex-wrap gap-2" data-testid="services-ipm-counts">
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted">
            <Radar className="size-3.5 text-[var(--accent)]" aria-hidden="true" />
            {payload.devices.filter((device) => device.status === "active").length} active stations
          </span>
          <span
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
              overThresholdCount > 0
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-line bg-surface text-muted",
            )}
          >
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {overThresholdCount} over threshold
          </span>
          <span
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
              openSightings.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-line bg-surface text-muted",
            )}
          >
            {openSightings.length} open {openSightings.length === 1 ? "sighting" : "sightings"}
          </span>
        </div>
      ) : null}

      <ScanCard onScan={(body) => act("/api/services/devices/scan", "POST", body)} />

      {payload === null && listError === null ? (
        <p className="text-sm text-muted">Loading the station map…</p>
      ) : payload !== null && sites.length === 0 ? (
        <Card>
          <p className="text-sm text-muted" data-testid="services-ipm-empty">
            No stations or sightings yet. Install device places the first barcoded station at a
            property; Log sighting starts the IPM loop — inspect, monitor, act, verify — and every
            scan lands on the station&apos;s permanent ledger.
          </p>
        </Card>
      ) : (
        <div className="space-y-6" data-testid="services-ipm-sites">
          {sites.map((site) => (
            <Card key={site.propertyId}>
              <SectionTitle
                title={site.label}
                description={accountNames.get(site.accountId) ?? ""}
              />
              {site.devices.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                        <th className="py-2 pr-3 font-medium">Station</th>
                        <th className="py-2 pr-3 font-medium">Barcode</th>
                        <th className="hidden py-2 pr-3 font-medium sm:table-cell">Location</th>
                        <th className="py-2 pr-3 font-medium">Activity</th>
                        <th className="py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {site.devices.map((device) => {
                        const latest = latestActivity.get(device.id);
                        const over =
                          device.status === "active"
                          && device.activityThreshold !== null
                          && latest !== undefined
                          && (latest.activityCount ?? 0) >= device.activityThreshold;
                        return (
                          <tr key={device.id}>
                            <td className="py-2.5 pr-3">
                              <span className="block font-medium text-foreground">{device.label}</span>
                              <span className="block text-xs text-faint">
                                {TYPE_LABELS[device.deviceType] ?? device.deviceType}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-xs text-muted">{device.barcode}</td>
                            <td className="hidden max-w-[14rem] py-2.5 pr-3 text-muted sm:table-cell">
                              <span className="block truncate">{device.locationNote ?? "—"}</span>
                            </td>
                            <td className="py-2.5 pr-3">
                              {latest ? (
                                <span className={cn("font-medium", over ? "text-rose-600" : "text-foreground")}>
                                  {latest.activityCount}
                                  {device.activityThreshold !== null ? (
                                    <span className="text-xs font-normal text-faint">
                                      {" "}/ {device.activityThreshold}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                              {over ? (
                                <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                  over threshold
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2.5">
                              <span
                                className={cn(
                                  "rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
                                  device.status === "active"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-slate-200 bg-slate-50 text-slate-500",
                                )}
                              >
                                {device.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {site.sightings.length > 0 ? (
                <ul className="mt-4 space-y-2.5" data-testid={`services-sightings-${site.propertyId}`}>
                  {site.sightings.map((sighting) => (
                    <li
                      key={sighting.id}
                      className={cn(
                        "rounded-lg border p-3 text-sm",
                        sighting.correctedAt === null
                          ? "border-amber-200 bg-amber-50/60"
                          : "border-line bg-surface-inset",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{sighting.pest}</span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-semibold capitalize",
                            SEVERITY_TONES[sighting.severity] ?? SEVERITY_TONES.moderate,
                          )}
                        >
                          {sighting.severity}
                        </span>
                        <span className="text-xs text-faint">
                          {sighting.sightedAt.slice(0, 10)}
                          {sighting.locationNote ? ` · ${sighting.locationNote}` : ""}
                        </span>
                      </div>
                      {sighting.note ? <p className="mt-1 text-xs text-muted">{sighting.note}</p> : null}
                      {sighting.correctedAt !== null ? (
                        <p className="mt-1.5 text-xs text-emerald-800">
                          Corrective action ({sighting.correctedAt.slice(0, 10)}): {sighting.correctiveAction}
                        </p>
                      ) : resolving?.id === sighting.id ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={resolving.action}
                            onChange={(event) =>
                              setResolving({ id: sighting.id, action: event.target.value })
                            }
                            maxLength={1000}
                            placeholder="What was done about it?"
                            aria-label={`Corrective action for ${sighting.pest}`}
                            className="input min-h-8 w-72 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (resolving.action.trim() === "") return;
                              void act(`/api/services/sightings/${sighting.id}`, "PATCH", {
                                correctiveAction: resolving.action.trim(),
                              });
                            }}
                            className="btn btn-primary px-2.5 py-1 text-xs"
                          >
                            Record action
                          </button>
                          <button
                            type="button"
                            onClick={() => setResolving(null)}
                            className="btn btn-secondary px-2.5 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setResolving({ id: sighting.id, action: "" })}
                          className="btn btn-secondary mt-2 px-2.5 py-1 text-xs"
                        >
                          Record corrective action
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ScanCard({ onScan }: { onScan: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [barcode, setBarcode] = useState("");
  const [event, setEvent] = useState<(typeof EVENTS)[number]>("service");
  const [condition, setCondition] = useState("");
  const [activityCount, setActivityCount] = useState("");
  const [pestObserved, setPestObserved] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Scan a station"
        description="Type or scan the barcode. The scan appends to the station's permanent ledger, and the station's state follows from it."
      />
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event_) => {
          event_.preventDefault();
          setBusy(true);
          setDone(null);
          const parsedCount = activityCount.trim() === "" ? null : Number(activityCount);
          void onScan({
            barcode: barcode.trim(),
            event,
            ...(condition !== "" ? { condition } : {}),
            ...(parsedCount !== null && Number.isInteger(parsedCount) && parsedCount >= 0
              ? { activityCount: parsedCount }
              : {}),
            ...(pestObserved.trim() ? { pestObserved: pestObserved.trim() } : {}),
            ...(locationNote.trim() ? { locationNote: locationNote.trim() } : {}),
          }).then((ok) => {
            setBusy(false);
            if (ok) {
              setDone(`Scan recorded: ${event} on ${barcode.trim()}.`);
              setBarcode("");
              setActivityCount("");
              setPestObserved("");
              setLocationNote("");
              setCondition("");
            }
          });
        }}
      >
        <label className="relative block text-sm lg:col-span-1">
          <ScanLine
            className="pointer-events-none absolute left-3 top-[2.4rem] size-4 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <span className="text-muted">Barcode</span>
          <input
            type="text"
            value={barcode}
            onChange={(event_) => setBarcode(event_.target.value)}
            required
            maxLength={64}
            placeholder="DEMO-ST-1001"
            className="input mt-1 w-full pl-9 font-mono"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Event</span>
          <select
            value={event}
            onChange={(event_) => setEvent(event_.target.value as (typeof EVENTS)[number])}
            className="input mt-1 w-full"
          >
            {EVENTS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Condition (optional)</span>
          <select
            value={condition}
            onChange={(event_) => setCondition(event_.target.value)}
            className="input mt-1 w-full"
          >
            <option value="">—</option>
            {CONDITIONS.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Captures / activity (optional)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={activityCount}
            onChange={(event_) => setActivityCount(event_.target.value)}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Pest observed (optional)</span>
          <input
            type="text"
            value={pestObserved}
            onChange={(event_) => setPestObserved(event_.target.value)}
            maxLength={120}
            placeholder="House mouse, German cockroach…"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">New location (for a move)</span>
          <input
            type="text"
            value={locationNote}
            onChange={(event_) => setLocationNote(event_.target.value)}
            maxLength={300}
            className="input mt-1 w-full"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Recording…" : "Record scan"}
          </button>
          {done !== null ? <span className="ml-3 text-sm text-muted">{done}</span> : null}
        </div>
      </form>
    </Card>
  );
}

function DeviceForm({
  accounts,
  onDone,
}: {
  accounts: AccountsPayload | null;
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [label, setLabel] = useState("");
  const [deviceType, setDeviceType] = useState<(typeof DEVICE_TYPES)[number]>("bait_station");
  const [barcode, setBarcode] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const properties = useAccountProperties(accountId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsedThreshold = threshold.trim() === "" ? null : Number(threshold);
      const response = await fetch("/api/services/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          propertyId,
          label: label.trim(),
          deviceType,
          barcode: barcode.trim(),
          ...(locationNote.trim() ? { locationNote: locationNote.trim() } : {}),
          ...(parsedThreshold !== null && Number.isInteger(parsedThreshold) && parsedThreshold >= 1
            ? { activityThreshold: parsedThreshold }
            : {}),
        }),
      });
      const body = (await response.json()) as { device?: unknown; error?: { message?: string } };
      if (!response.ok || !body.device) {
        setError(body.error?.message ?? "The device could not be recorded.");
        return;
      }
      onDone();
    } catch {
      setError("The request did not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Install a station"
        description="One barcoded device at one of the account's own properties. The database writes the install scan the moment the station exists."
      />
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
              {accountId === ""
                ? "Pick the account first…"
                : properties.length === 0
                  ? "No properties on this account yet"
                  : "Pick the property…"}
            </option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Station label</span>
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={120}
            placeholder="Station 12"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Type</span>
          <select
            value={deviceType}
            onChange={(event) => setDeviceType(event.target.value as (typeof DEVICE_TYPES)[number])}
            className="input mt-1 w-full"
          >
            {DEVICE_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {TYPE_LABELS[entry]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Barcode / QR value</span>
          <input
            type="text"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            required
            maxLength={64}
            placeholder="Unique in this workspace"
            className="input mt-1 w-full font-mono"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Activity threshold (optional)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            placeholder="Flag at or above…"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm sm:col-span-2 lg:col-span-3">
          <span className="text-muted">Location on site (optional)</span>
          <input
            type="text"
            value={locationNote}
            onChange={(event) => setLocationNote(event.target.value)}
            maxLength={300}
            placeholder="North fence line, dock door 3…"
            className="input mt-1 w-full"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Installing…" : "Install station"}
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

function SightingForm({
  accounts,
  onDone,
}: {
  accounts: AccountsPayload | null;
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [pest, setPest] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("moderate");
  const [locationNote, setLocationNote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const properties = useAccountProperties(accountId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/services/sightings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          propertyId,
          pest: pest.trim(),
          severity,
          ...(locationNote.trim() ? { locationNote: locationNote.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const body = (await response.json()) as { sighting?: unknown; error?: { message?: string } };
      if (!response.ok || !body.sighting) {
        setError(body.error?.message ?? "The sighting could not be recorded.");
        return;
      }
      onDone();
    } catch {
      setError("The request did not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <SectionTitle
        title="Log a pest sighting"
        description="Where the IPM loop starts. It stays open until its corrective action is recorded — never deleted."
      />
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
              {accountId === ""
                ? "Pick the account first…"
                : properties.length === 0
                  ? "No properties on this account yet"
                  : "Pick the property…"}
            </option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Pest</span>
          <input
            type="text"
            value={pest}
            onChange={(event) => setPest(event.target.value)}
            required
            maxLength={120}
            placeholder="House mouse, German cockroach…"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Severity</span>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as (typeof SEVERITIES)[number])}
            className="input mt-1 w-full"
          >
            {SEVERITIES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Where (optional)</span>
          <input
            type="text"
            value={locationNote}
            onChange={(event) => setLocationNote(event.target.value)}
            maxLength={300}
            placeholder="Dish pit, dock door 7…"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Notes (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            className="input mt-1 w-full"
          />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Logging…" : "Log sighting"}
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
