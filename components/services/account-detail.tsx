"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { AccountDetailPayload } from "@/components/services/types";

/**
 * One account's 360-degree record: its fields and lifecycle status, its
 * people, its properties, and the immutable timeline. Status moves through
 * the real PATCH — the history line is written by the database trigger, so
 * the page never invents one — and every addition re-reads the record
 * rather than optimistically fabricating state.
 */

const STATUSES = ["lead", "prospect", "customer", "inactive"] as const;

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

  const { account, contacts, properties, timeline, timelineTruncated } = detail;

  return (
    <div>
      <PageHeader
        title={account.name}
        description={`${account.kind} account · recorded ${account.createdAt.slice(0, 10)}${account.source ? ` · source: ${account.source}` : ""}`}
        action={
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
        }
      />

      {actionError !== null ? <Notice tone="warning">{actionError}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Details" />
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Email</dt>
            <dd>{account.email ?? "—"}</dd>
            <dt className="text-muted">Phone</dt>
            <dd>{account.phone ?? "—"}</dd>
            <dt className="text-muted">Billing address</dt>
            <dd className="break-words">{account.billingAddress ?? "—"}</dd>
            <dt className="text-muted">Notes</dt>
            <dd className="break-words">{account.notes ?? "—"}</dd>
          </dl>
        </Card>

        <Card>
          <SectionTitle
            title={`Contacts (${contacts.length})`}
            description="The people on this account."
          />
          {contacts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No contacts recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">
                    {contact.firstName}
                    {contact.lastName ? ` ${contact.lastName}` : ""}
                  </span>
                  {contact.isPrimary ? (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                      primary
                    </span>
                  ) : null}
                  <span className="text-muted">
                    {[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") || ""}
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
            <ul className="mt-3 space-y-2 text-sm">
              {properties.map((property) => (
                <li key={property.id}>
                  <span className="font-medium">{property.label}</span>
                  <span className="text-muted"> · {property.address}</span>
                  {property.propertyType ? (
                    <span className="text-muted"> · {property.propertyType}</span>
                  ) : null}
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
            <ul className="mt-3 space-y-2 text-sm" data-testid="services-timeline">
              {timeline.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="shrink-0 text-xs text-faint">{event.occurredAt.slice(0, 16).replace("T", " ")}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    {event.kind}
                    {event.recordedBySystem ? " · system" : ""}
                  </span>
                  <span className="min-w-0 break-words">{event.summary}</span>
                </li>
              ))}
            </ul>
          )}
          {timelineTruncated ? (
            <p className="mt-2 text-xs text-faint">
              Showing the newest 100 entries; older history is retained and will page in a later
              increment.
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
