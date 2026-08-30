"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  CheckSquare,
  CreditCard,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  StickyNote,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import {
  AccountAvatar,
  AccountStatusBadge,
  StageBadge,
  dollars,
} from "@/components/services/ui";
import { cn } from "@/lib/cn";
import type { AccountDetailPayload } from "@/components/services/types";

/**
 * One account's 360-degree record: its fields and lifecycle status, its
 * people, its properties, its deals, and the immutable timeline. Status
 * moves through the real PATCH — the history line is written by the
 * database trigger, so the page never invents one — and every addition
 * re-reads the record rather than optimistically fabricating state.
 */

const STATUSES = ["lead", "prospect", "customer", "inactive"] as const;
const OPPORTUNITY_STAGES = [
  "new",
  "contacted",
  "inspection",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

const EVENT_ICONS: Record<string, LucideIcon> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  sms: MessageSquare,
  task: CheckSquare,
  status_change: ArrowLeftRight,
  service: Wrench,
  payment: CreditCard,
};

export function ServicesAccountDetail({ accountId }: { accountId: string }) {
  const [detail, setDetail] = useState<AccountDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [noteSummary, setNoteSummary] = useState("");
  const [noteKind, setNoteKind] = useState("note");
  const [contactFirst, setContactFirst] = useState("");
  const [contactLast, setContactLast] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [propertyLabel, setPropertyLabel] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [opportunityName, setOpportunityName] = useState("");
  const [opportunityValue, setOpportunityValue] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/services/accounts/${accountId}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as AccountDetailPayload & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "The account could not be read.");
        return;
      }
      setError(null);
      setDetail(body);
    } catch {
      setError("The account could not be read.");
    }
  }, [accountId]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const act = useCallback(
    async (input: { url: string; method: string; body: unknown; after?: () => void }) => {
      setBusy(true);
      setActionError(null);
      try {
        const response = await fetch(input.url, {
          method: input.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        });
        const body = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) {
          setActionError(body.error?.message ?? "The change could not be recorded.");
          return;
        }
        input.after?.();
        void refresh();
      } catch {
        setActionError("The request did not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (error !== null && detail === null) {
    return (
      <div>
        <PageHeader title="Account" description="This record could not be read." />
        <Notice tone="warning">{error}</Notice>
        <Link href="/Services/customers" className="underline underline-offset-2">
          Back to Customers &amp; Leads
        </Link>
      </div>
    );
  }
  if (detail === null) {
    return (
      <div>
        <PageHeader title="Account" description="Reading the record…" />
        <Card className="h-40 animate-pulse">
          <span className="sr-only">Loading</span>
        </Card>
      </div>
    );
  }

  const { account, contacts, properties, opportunities, timeline, timelineTruncated } = detail;

  return (
    <div>
      <nav className="mb-4 text-xs text-faint">
        <Link href="/Services/customers" className="underline-offset-2 hover:underline">
          Customers &amp; Leads
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-muted">{account.name}</span>
      </nav>

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <AccountAvatar name={account.name} size="lg" />
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight text-foreground">
                <span className="break-words">{account.name}</span>
                <AccountStatusBadge status={account.status} />
              </h1>
              <p className="mt-1 text-sm text-muted">
                <span className="capitalize">{account.kind}</span> account · recorded{" "}
                {account.createdAt.slice(0, 10)}
                {account.source ? ` · source: ${account.source}` : ""}
              </p>
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                {account.email ? (
                  <span className="flex items-center gap-1.5">
                    <Mail className="size-3.5 text-faint" aria-hidden="true" />
                    {account.email}
                  </span>
                ) : null}
                {account.phone ? (
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-3.5 text-faint" aria-hidden="true" />
                    {account.phone}
                  </span>
                ) : null}
                {account.billingAddress ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
                    <span className="truncate">{account.billingAddress}</span>
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Status</span>
            <select
              value={account.status}
              disabled={busy}
              onChange={(event) =>
                void act({
                  url: `/api/services/accounts/${accountId}`,
                  method: "PATCH",
                  body: { status: event.target.value },
                })
              }
              className="input"
            >
              {STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>
        {account.notes ? (
          <p className="mt-4 rounded-lg bg-surface-raised p-3 text-sm leading-relaxed text-muted">
            {account.notes}
          </p>
        ) : null}
      </Card>

      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title={`Contacts (${contacts.length})`}
            description="The people on this account."
          />
          {contacts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No contacts recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-sm">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex items-center gap-3">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-faint"
                    aria-hidden="true"
                  >
                    <Users className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {contact.firstName}
                      {contact.lastName ? ` ${contact.lastName}` : ""}
                      {contact.isPrimary ? (
                        <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-surface)] px-2 py-0.5 text-xs font-medium text-[var(--accent-text)]">
                          primary
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void act({
                url: `/api/services/accounts/${accountId}/contacts`,
                method: "POST",
                body: {
                  firstName: contactFirst.trim(),
                  ...(contactLast.trim() ? { lastName: contactLast.trim() } : {}),
                  ...(contactPhone.trim() ? { phone: contactPhone.trim() } : {}),
                  isPrimary: contacts.length === 0,
                },
                after: () => {
                  setContactFirst("");
                  setContactLast("");
                  setContactPhone("");
                },
              });
            }}
          >
            <input
              type="text"
              value={contactFirst}
              onChange={(event) => setContactFirst(event.target.value)}
              required
              maxLength={100}
              placeholder="First name"
              aria-label="Contact first name"
              className="input"
            />
            <input
              type="text"
              value={contactLast}
              onChange={(event) => setContactLast(event.target.value)}
              maxLength={100}
              placeholder="Last name"
              aria-label="Contact last name"
              className="input"
            />
            <input
              type="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              maxLength={32}
              placeholder="Phone"
              aria-label="Contact phone"
              className="input"
            />
            <button type="submit" disabled={busy} className="btn btn-secondary px-3 py-2 text-sm">
              Add
            </button>
          </form>
        </Card>

        <Card>
          <SectionTitle
            title={`Properties (${properties.length})`}
            description="The sites where service happens — work orders and IPM device maps will hang off these."
          />
          {properties.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No properties recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-sm">
              {properties.map((property) => (
                <li key={property.id} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-faint"
                    aria-hidden="true"
                  >
                    <MapPin className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {property.label}
                      {property.propertyType ? (
                        <span className="rounded-full border border-line bg-surface-raised px-2 py-0.5 text-xs text-muted">
                          {property.propertyType}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted">{property.address}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void act({
                url: `/api/services/accounts/${accountId}/properties`,
                method: "POST",
                body: {
                  label: propertyLabel.trim(),
                  address: propertyAddress.trim(),
                },
                after: () => {
                  setPropertyLabel("");
                  setPropertyAddress("");
                },
              });
            }}
          >
            <input
              type="text"
              value={propertyLabel}
              onChange={(event) => setPropertyLabel(event.target.value)}
              required
              maxLength={200}
              placeholder="Label (Home, Warehouse A…)"
              aria-label="Property label"
              className="input"
            />
            <input
              type="text"
              value={propertyAddress}
              onChange={(event) => setPropertyAddress(event.target.value)}
              required
              maxLength={500}
              placeholder="Address"
              aria-label="Property address"
              className="input"
            />
            <button type="submit" disabled={busy} className="btn btn-secondary px-3 py-2 text-sm">
              Add
            </button>
          </form>
        </Card>

        <Card>
          <SectionTitle
            title={`Opportunities (${opportunities.length})`}
            description="Deals on this account. Stage moves land on the timeline below, written by the database."
          />
          {opportunities.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              No opportunities yet. Record the first deal below, or work the whole board under{" "}
              <Link href="/Services/pipeline" className="underline underline-offset-2">
                Pipeline
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-sm" data-testid="services-account-opportunities">
              {opportunities.map((opportunity) => (
                <li
                  key={opportunity.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-inset px-3 py-2.5"
                >
                  <span className="min-w-0 font-medium text-foreground">{opportunity.name}</span>
                  <StageBadge stage={opportunity.stage} />
                  <span className="text-muted">
                    {dollars(opportunity.valueCents)}
                    {opportunity.expectedCloseDate ? ` · closes ${opportunity.expectedCloseDate}` : ""}
                    {opportunity.stage === "lost" && opportunity.lostReason
                      ? ` · lost: ${opportunity.lostReason}`
                      : ""}
                  </span>
                  <label className="ml-auto shrink-0 text-xs">
                    <span className="sr-only">Stage for {opportunity.name}</span>
                    <select
                      value={opportunity.stage}
                      disabled={busy}
                      onChange={(event) =>
                        void act({
                          url: `/api/services/opportunities/${opportunity.id}`,
                          method: "PATCH",
                          body: { stage: event.target.value },
                        })
                      }
                      className="input min-h-8 py-1 text-xs"
                    >
                      {OPPORTUNITY_STAGES.map((entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[2fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const parsedValue = opportunityValue.trim() === "" ? null : Number(opportunityValue);
              void act({
                url: "/api/services/opportunities",
                method: "POST",
                body: {
                  accountId,
                  name: opportunityName.trim(),
                  ...(parsedValue !== null && Number.isFinite(parsedValue) && parsedValue >= 0
                    ? { valueCents: Math.round(parsedValue * 100) }
                    : {}),
                },
                after: () => {
                  setOpportunityName("");
                  setOpportunityValue("");
                },
              });
            }}
          >
            <input
              type="text"
              value={opportunityName}
              onChange={(event) => setOpportunityName(event.target.value)}
              required
              maxLength={200}
              placeholder="Deal name (Quarterly IPM service…)"
              aria-label="Opportunity name"
              className="input"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={opportunityValue}
              onChange={(event) => setOpportunityValue(event.target.value)}
              placeholder="Value $"
              aria-label="Opportunity value in dollars"
              className="input"
            />
            <button type="submit" disabled={busy} className="btn btn-secondary px-3 py-2 text-sm">
              Add
            </button>
          </form>
        </Card>

        <Card>
          <SectionTitle
            title="Timeline"
            description="Immutable history — entries are recorded, never edited or deleted. Status changes write themselves."
          />
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void act({
                url: `/api/services/accounts/${accountId}/timeline`,
                method: "POST",
                body: { kind: noteKind, summary: noteSummary.trim() },
                after: () => setNoteSummary(""),
              });
            }}
          >
            <select
              value={noteKind}
              onChange={(event) => setNoteKind(event.target.value)}
              aria-label="Entry kind"
              className="input"
            >
              <option value="note">Note</option>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="task">Task</option>
            </select>
            <input
              type="text"
              value={noteSummary}
              onChange={(event) => setNoteSummary(event.target.value)}
              required
              maxLength={300}
              placeholder="What happened?"
              aria-label="Entry summary"
              className="input"
            />
            <button type="submit" disabled={busy} className="btn btn-secondary px-3 py-2 text-sm">
              Record
            </button>
          </form>
          {timeline.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Nothing recorded yet. The first entry starts this account&apos;s permanent history.
            </p>
          ) : (
            <ol className="relative mt-4 space-y-4 pl-6 before:absolute before:bottom-1 before:left-[9px] before:top-1 before:w-px before:bg-line" data-testid="services-timeline">
              {timeline.map((event) => {
                const Icon = EVENT_ICONS[event.kind] ?? StickyNote;
                return (
                  <li key={event.id} className="relative text-sm">
                    <span
                      className={cn(
                        "absolute -left-6 top-0 flex size-5 items-center justify-center rounded-full border",
                        event.recordedBySystem
                          ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                          : "border-line bg-surface-raised text-faint",
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="size-3" />
                    </span>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs font-medium text-faint">
                        {event.occurredAt.slice(0, 16).replace("T", " ")}
                      </span>
                      <span className="rounded-full border border-line bg-surface-raised px-2 py-0.5 text-xs text-muted">
                        {event.kind}
                        {event.recordedBySystem ? " · system" : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 min-w-0 break-words leading-relaxed text-foreground">
                      {event.summary}
                    </p>
                    {event.detail ? (
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-muted">
                        {event.detail}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {timelineTruncated ? (
            <p className="mt-2 text-xs text-faint">
              Showing the newest 100 entries; older history is retained and will page in a later
              increment.
            </p>
          ) : null}
        </Card>
      </div>

      <p className="mt-6 text-xs text-faint">
        <Link
          href="/Services/pipeline"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          Work the pipeline board
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}
