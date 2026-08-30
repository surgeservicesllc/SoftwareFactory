"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Repeat } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { AccountAvatar, dollars } from "@/components/services/ui";
import { cn } from "@/lib/cn";
import type {
  AccountDetailPayload,
  AccountsPayload,
  PropertyView,
  ServicePlansPayload,
  TechniciansPayload,
  WorkOrdersPayload,
} from "@/components/services/types";

/**
 * The schedule: every work order from booked to done, the recurring plans
 * that generate them, and the technician each visit belongs to. Everything
 * is a real row under RLS: assigning, rescheduling and progressing PATCH
 * the work order; completing asks for the field notes first, and the
 * database writes the service event onto the account's timeline itself.
 */

const STATUSES = ["scheduled", "dispatched", "in_progress", "completed", "cancelled"] as const;
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_DOTS: Record<string, string> = {
  scheduled: "bg-slate-400",
  dispatched: "bg-sky-500",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-rose-400",
};
const RECURRENCES = [
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;

function windowOf(startIso: string, endIso: string): string {
  const day = startIso.slice(0, 10);
  const start = startIso.slice(11, 16);
  const end = endIso.slice(11, 16);
  return `${day} · ${start}–${end}`;
}

export function ServicesSchedulePanel() {
  const [workOrders, setWorkOrders] = useState<WorkOrdersPayload | null>(null);
  const [plans, setPlans] = useState<ServicePlansPayload | null>(null);
  const [technicians, setTechnicians] = useState<TechniciansPayload | null>(null);
  const [accounts, setAccounts] = useState<AccountsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<"workOrder" | "plan" | null>(null);
  const [pendingComplete, setPendingComplete] = useState<{ id: string; notes: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ordersRes, plansRes, techsRes, accountsRes] = await Promise.all([
        fetch("/api/services/work-orders", { headers: { accept: "application/json" } }),
        fetch("/api/services/service-plans", { headers: { accept: "application/json" } }),
        fetch("/api/services/technicians", { headers: { accept: "application/json" } }),
        fetch("/api/services/accounts", { headers: { accept: "application/json" } }),
      ]);
      const ordersBody = (await ordersRes.json()) as WorkOrdersPayload & {
        error?: { message?: string };
      };
      if (!ordersRes.ok) {
        setListError(ordersBody.error?.message ?? "The schedule could not be listed.");
        return;
      }
      setListError(null);
      setWorkOrders(ordersBody);
      if (plansRes.ok) setPlans((await plansRes.json()) as ServicePlansPayload);
      if (techsRes.ok) setTechnicians((await techsRes.json()) as TechniciansPayload);
      if (accountsRes.ok) setAccounts((await accountsRes.json()) as AccountsPayload);
    } catch {
      setListError("The schedule could not be listed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const act = useCallback(
    async (url: string, method: string, body?: unknown) => {
      setActError(null);
      try {
        const response = await fetch(url, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          const parsed = (await response.json()) as { error?: { message?: string } };
          setActError(parsed.error?.message ?? "The change could not be recorded.");
          return false;
        }
        setPendingComplete(null);
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

  const technicianNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const technician of technicians?.technicians ?? []) {
      map.set(
        technician.id,
        [technician.firstName, technician.lastName].filter(Boolean).join(" "),
      );
    }
    return map;
  }, [technicians]);

  const today = new Date().toISOString().slice(0, 10);
  const duePlans = (plans?.plans ?? []).filter((plan) => plan.active && plan.nextDue <= today);

  const ordersByDay = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof workOrders>["workOrders"]>();
    for (const order of workOrders?.workOrders ?? []) {
      const day = order.scheduledStart.slice(0, 10);
      const group = groups.get(day) ?? [];
      group.push(order);
      groups.set(day, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workOrders]);

  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Work orders from booked to done, and the recurring plans that generate them. Completing a visit writes the service onto the account's timeline — by the database, never by hand."
        action={
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpenForm((current) => (current === "workOrder" ? null : "workOrder"))}
              className="btn btn-primary px-3 py-2 text-sm"
            >
              {openForm === "workOrder" ? "Close" : "New work order"}
            </button>
            <button
              type="button"
              onClick={() => setOpenForm((current) => (current === "plan" ? null : "plan"))}
              className="btn btn-secondary px-3 py-2 text-sm"
            >
              {openForm === "plan" ? "Close" : "New plan"}
            </button>
          </span>
        }
      />

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      {openForm === "workOrder" ? (
        <WorkOrderForm
          accounts={accounts}
          technicians={technicians}
          onDone={() => {
            setOpenForm(null);
            void refresh();
          }}
        />
      ) : null}
      {openForm === "plan" ? (
        <PlanForm
          accounts={accounts}
          technicians={technicians}
          onDone={() => {
            setOpenForm(null);
            void refresh();
          }}
        />
      ) : null}

      {workOrders !== null ? (
        <div className="mb-6 flex flex-wrap gap-2" data-testid="services-schedule-counts">
          {STATUSES.map((status) => (
            <span
              key={status}
              className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted"
            >
              <span className={cn("size-2 rounded-full", STATUS_DOTS[status])} aria-hidden="true" />
              {STATUS_LABELS[status]} {workOrders.counts.byStatus[status] ?? 0}
            </span>
          ))}
        </div>
      ) : null}

      {duePlans.length > 0 ? (
        <Card className="mb-6 border-[var(--accent-border)]">
          <SectionTitle
            title={`Plans due (${duePlans.length})`}
            description="Active recurring plans at or past their next due date. Generating creates the real visit and advances the plan."
          />
          <ul className="mt-3 divide-y divide-line" data-testid="services-due-plans">
            {duePlans.map((plan) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Repeat className="size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {plan.serviceType}
                    <span className="font-normal text-muted">
                      {" "}
                      · {accountNames.get(plan.accountId) ?? "account"} · {plan.recurrence}
                    </span>
                  </span>
                  <span className="block text-xs text-faint">
                    due {plan.nextDue}
                    {plan.technicianId
                      ? ` · ${technicianNames.get(plan.technicianId) ?? "assigned"}`
                      : " · unassigned"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void act(`/api/services/service-plans/${plan.id}/generate`, "POST")}
                  className="btn btn-primary px-3 py-1.5 text-xs"
                >
                  Generate visit
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {workOrders === null && listError === null ? (
        <p className="text-sm text-muted">Loading the schedule…</p>
      ) : workOrders !== null && workOrders.workOrders.length === 0 ? (
        <Card>
          <p className="text-sm text-muted" data-testid="services-schedule-empty">
            No work orders yet. Use New work order above to book the first visit, or New plan to
            start a recurring agreement — a due plan generates its visits from here.
          </p>
        </Card>
      ) : workOrders !== null ? (
        <div className="space-y-6" data-testid="services-schedule-board">
          {ordersByDay.map(([day, orders]) => (
            <Card key={day}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CalendarClock className="size-4 text-[var(--accent)]" aria-hidden="true" />
                {day}
              </h3>
              <ul className="mt-3 divide-y divide-line">
                {orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_DOTS[order.status])} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{order.serviceType}</span>
                        <Link
                          href={`/Services/customers/${order.accountId}`}
                          className="flex items-center gap-1.5 text-muted underline-offset-2 hover:underline"
                        >
                          <AccountAvatar
                            name={accountNames.get(order.accountId) ?? "?"}
                            size="sm"
                            className="size-5 rounded text-[9px]"
                          />
                          {accountNames.get(order.accountId) ?? "View account"}
                        </Link>
                      </span>
                      <span className="block text-xs text-faint">
                        {windowOf(order.scheduledStart, order.scheduledEnd)}
                        {order.completionNotes && order.status === "completed"
                          ? ` · ${order.completionNotes}`
                          : ""}
                      </span>
                    </span>
                    {order.status === "completed" || order.status === "cancelled" ? (
                      <span className="text-xs capitalize text-muted">{STATUS_LABELS[order.status as (typeof STATUSES)[number]]}</span>
                    ) : pendingComplete?.id === order.id ? (
                      <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <input
                          type="text"
                          value={pendingComplete.notes}
                          onChange={(event) =>
                            setPendingComplete({ id: order.id, notes: event.target.value })
                          }
                          maxLength={3500}
                          placeholder="Field notes for the record…"
                          aria-label={`Completion notes for ${order.serviceType}`}
                          className="input min-h-8 w-56 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            void act(`/api/services/work-orders/${order.id}`, "PATCH", {
                              status: "completed",
                              ...(pendingComplete.notes.trim()
                                ? { completionNotes: pendingComplete.notes.trim() }
                                : {}),
                            })
                          }
                          className="btn btn-primary px-2.5 py-1 text-xs"
                        >
                          Complete visit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingComplete(null)}
                          className="btn btn-secondary px-2.5 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-2">
                        <label className="text-xs">
                          <span className="sr-only">Technician for {order.serviceType}</span>
                          <select
                            value={order.technicianId ?? ""}
                            onChange={(event) =>
                              void act(`/api/services/work-orders/${order.id}`, "PATCH", {
                                technicianId: event.target.value === "" ? null : event.target.value,
                              })
                            }
                            className="input min-h-8 py-1 text-xs"
                          >
                            <option value="">Unassigned</option>
                            {(technicians?.technicians ?? [])
                              .filter((technician) => technician.active)
                              .map((technician) => (
                                <option key={technician.id} value={technician.id}>
                                  {[technician.firstName, technician.lastName].filter(Boolean).join(" ")}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="text-xs">
                          <span className="sr-only">Status for {order.serviceType}</span>
                          <select
                            value={order.status}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next === order.status) return;
                              if (next === "completed") {
                                setPendingComplete({ id: order.id, notes: "" });
                                return;
                              }
                              void act(`/api/services/work-orders/${order.id}`, "PATCH", {
                                status: next,
                              });
                            }}
                            className="input min-h-8 py-1 text-xs"
                          >
                            {STATUSES.map((entry) => (
                              <option key={entry} value={entry}>
                                {STATUS_LABELS[entry]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}

      {plans !== null && plans.plans.length > 0 ? (
        <Card className="mt-6">
          <SectionTitle
            title={`Recurring plans (${plans.plans.length})`}
            description="The agreements that keep the book serviced. Pausing stops generation; nothing is ever deleted."
          />
          <ul className="mt-3 divide-y divide-line" data-testid="services-plans">
            {plans.plans.map((plan) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {plan.serviceType}
                    <span className="font-normal text-muted">
                      {" "}
                      · {accountNames.get(plan.accountId) ?? "account"} · {plan.recurrence} ·{" "}
                      {dollars(plan.valueCents)}
                    </span>
                  </span>
                  <span className="block text-xs text-faint">
                    next due {plan.nextDue}
                    {plan.active ? "" : " · paused"}
                  </span>
                </span>
                {plan.active ? (
                  <button
                    type="button"
                    onClick={() => void act(`/api/services/service-plans/${plan.id}/generate`, "POST")}
                    className="btn btn-secondary px-2.5 py-1 text-xs"
                  >
                    Generate visit
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    void act(`/api/services/service-plans/${plan.id}`, "PATCH", {
                      active: !plan.active,
                    })
                  }
                  className="btn btn-secondary px-2.5 py-1 text-xs"
                >
                  {plan.active ? "Pause" : "Resume"}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Fetches the chosen account's properties so a visit lands on a real site.
 * The list is keyed to the account it was loaded for, so switching accounts
 * shows an empty select until the right list arrives — never a stale one.
 */
function useAccountProperties(accountId: string): PropertyView[] {
  const [loaded, setLoaded] = useState<{ forAccount: string; list: PropertyView[] }>({
    forAccount: "",
    list: [],
  });
  useEffect(() => {
    if (accountId === "") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/services/accounts/${accountId}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as AccountDetailPayload;
        setLoaded({ forAccount: accountId, list: body.properties });
      } catch {
        /* the select simply stays empty; the submit will say why */
      }
    })();
    return () => controller.abort();
  }, [accountId]);
  return loaded.forAccount === accountId ? loaded.list : [];
}

function WorkOrderForm({
  accounts,
  technicians,
  onDone,
}: {
  accounts: AccountsPayload | null;
  technicians: TechniciansPayload | null;
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const properties = useAccountProperties(accountId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/services/work-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          propertyId,
          serviceType: serviceType.trim(),
          scheduledStart: new Date(start).toISOString(),
          scheduledEnd: new Date(end).toISOString(),
          ...(technicianId !== "" ? { technicianId } : {}),
        }),
      });
      const body = (await response.json()) as { workOrder?: unknown; error?: { message?: string } };
      if (!response.ok || !body.workOrder) {
        setError(body.error?.message ?? "The work order could not be recorded.");
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
        title="Book a work order"
        description="One visit at one of the account's own properties, starting scheduled."
      />
      {accounts !== null && accounts.accounts.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          A visit belongs to an account. Record the account first under{" "}
          <Link href="/Services/customers" className="underline underline-offset-2">
            Customers &amp; Leads
          </Link>
          .
        </p>
      ) : (
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
            <span className="text-muted">Service type</span>
            <input
              type="text"
              value={serviceType}
              onChange={(event) => setServiceType(event.target.value)}
              required
              maxLength={120}
              placeholder="Quarterly IPM visit, rodent follow-up…"
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Technician (optional)</span>
            <select
              value={technicianId}
              onChange={(event) => setTechnicianId(event.target.value)}
              className="input mt-1 w-full"
            >
              <option value="">Unassigned</option>
              {(technicians?.technicians ?? [])
                .filter((technician) => technician.active)
                .map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {[technician.firstName, technician.lastName].filter(Boolean).join(" ")}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">Starts</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
              className="input mt-1 w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Ends</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              required
              className="input mt-1 w-full"
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
              {busy ? "Booking…" : "Book work order"}
            </button>
          </div>
        </form>
      )}
      {error !== null ? (
        <div className="mt-3">
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function PlanForm({
  accounts,
  technicians,
  onDone,
}: {
  accounts: AccountsPayload | null;
  technicians: TechniciansPayload | null;
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [recurrence, setRecurrence] = useState<(typeof RECURRENCES)[number]>("quarterly");
  const [nextDue, setNextDue] = useState("");
  const [valueDollars, setValueDollars] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const properties = useAccountProperties(accountId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsedValue = valueDollars.trim() === "" ? null : Number(valueDollars);
      const response = await fetch("/api/services/service-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          propertyId,
          serviceType: serviceType.trim(),
          recurrence,
          nextDue,
          ...(technicianId !== "" ? { technicianId } : {}),
          ...(parsedValue !== null && Number.isFinite(parsedValue) && parsedValue >= 0
            ? { valueCents: Math.round(parsedValue * 100) }
            : {}),
        }),
      });
      const body = (await response.json()) as { plan?: unknown; error?: { message?: string } };
      if (!response.ok || !body.plan) {
        setError(body.error?.message ?? "The service plan could not be recorded.");
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
        title="Start a recurring plan"
        description="The agreement that generates visits — each one a real work order, the plan advancing by its recurrence."
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
          <span className="text-muted">Service type</span>
          <input
            type="text"
            value={serviceType}
            onChange={(event) => setServiceType(event.target.value)}
            required
            maxLength={120}
            placeholder="Monthly IPM service…"
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Recurrence</span>
          <select
            value={recurrence}
            onChange={(event) => setRecurrence(event.target.value as (typeof RECURRENCES)[number])}
            className="input mt-1 w-full"
          >
            {RECURRENCES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">First visit due</span>
          <input
            type="date"
            value={nextDue}
            onChange={(event) => setNextDue(event.target.value)}
            required
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Value per visit in dollars (optional)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={valueDollars}
            onChange={(event) => setValueDollars(event.target.value)}
            className="input mt-1 w-full"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Technician (optional)</span>
          <select
            value={technicianId}
            onChange={(event) => setTechnicianId(event.target.value)}
            className="input mt-1 w-full"
          >
            <option value="">Unassigned</option>
            {(technicians?.technicians ?? [])
              .filter((technician) => technician.active)
              .map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {[technician.firstName, technician.lastName].filter(Boolean).join(" ")}
                </option>
              ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
            {busy ? "Starting…" : "Start plan"}
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
