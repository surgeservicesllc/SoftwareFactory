"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { AccountsPayload } from "@/components/services/types";

/**
 * The book of business: every account this workspace holds, searchable and
 * filterable, with the form that records a new one. Creation is a real
 * insert under RLS; a refusal comes back in the server's words, and the
 * list re-reads rather than optimistically inventing a row.
 */

const STATUSES = ["lead", "prospect", "customer", "inactive"] as const;
const KINDS = ["residential", "commercial"] as const;

export function ServicesCustomersPanel() {
  const [payload, setPayload] = useState<AccountsPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [newKind, setNewKind] = useState<(typeof KINDS)[number]>("residential");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim().length > 0) params.set("q", q.trim());
      if (status !== "") params.set("status", status);
      if (kind !== "") params.set("kind", kind);
      const suffix = params.toString();
      const response = await fetch(`/api/services/accounts${suffix ? `?${suffix}` : ""}`, {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as AccountsPayload & { error?: { message?: string } };
      if (!response.ok) {
        setListError(body.error?.message ?? "Accounts could not be listed.");
        return;
      }
      setListError(null);
      setPayload(body);
    } catch {
      setListError("Accounts could not be listed.");
    }
  }, [q, status, kind]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const create = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    setCreated(null);
    try {
      const response = await fetch("/api/services/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind: newKind,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(source.trim() ? { source: source.trim() } : {}),
        }),
      });
      const body = (await response.json()) as {
        account?: { id: string; name: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.account) {
        setCreateError(body.error?.message ?? "The account could not be recorded.");
        return;
      }
      setCreated(`${body.account.name} is recorded as a lead.`);
      setName("");
      setEmail("");
      setPhone("");
      setSource("");
      void refresh();
    } catch {
      setCreateError("The request did not reach the server.");
    } finally {
      setCreating(false);
    }
  }, [name, newKind, email, phone, source, refresh]);

  const accounts = payload?.accounts ?? null;

  return (
    <div>
      <PageHeader
        title="Customers & Leads"
        description="Every account in this workspace — residential and commercial — with its lifecycle, contacts, properties and history one click away."
        action={
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="btn btn-primary px-3 py-2 text-sm"
          >
            {showForm ? "Close" : "New account"}
          </button>
        }
      />

      {showForm ? (
        <Card className="mb-6">
          <SectionTitle
            title="Record a new account"
            description="Creates a real account in this workspace, starting as a lead. Move its status as the relationship moves."
          />
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
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
                placeholder="Person or company"
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Kind</span>
              <select
                value={newKind}
                onChange={(event) => setNewKind(event.target.value as (typeof KINDS)[number])}
                className="input mt-1 w-full"
              >
                {KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted">Email (optional)</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={320}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Phone (optional)</span>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={32}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">Source (optional — where they heard of you)</span>
              <input
                type="text"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={120}
                placeholder="Referral, website, door knock…"
                className="input mt-1 w-full"
              />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={creating} className="btn btn-primary px-4 py-2 text-sm">
                {creating ? "Recording…" : "Record account"}
              </button>
            </div>
          </form>
          {createError !== null ? (
            <div className="mt-3">
              <Notice tone="warning">{createError}</Notice>
            </div>
          ) : null}
          {created !== null ? <p className="mt-3 text-sm text-muted">{created}</p> : null}
        </Card>
      ) : null}

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <Card>
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void refresh();
          }}
        >
          <label className="block">
            <span className="sr-only">Search by name</span>
            <input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search by name"
              maxLength={120}
              className="input w-full"
            />
          </label>
          <label className="block">
            <span className="sr-only">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="input w-full">
              <option value="">Any status</option>
              {STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Kind</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)} className="input w-full">
              <option value="">Any kind</option>
              {KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary px-4 py-2 text-sm">
            Filter
          </button>
        </form>

        {accounts === null && listError === null ? (
          <p className="mt-4 text-sm text-muted">Loading the book of business…</p>
        ) : accounts !== null && accounts.length === 0 ? (
          <p className="mt-4 text-sm text-muted" data-testid="services-empty">
            {payload && payload.counts.total > 0
              ? "Nothing matches these filters. Clear them to see the whole book."
              : "No accounts yet. Use New account above to record your first lead — it becomes a real record in this workspace, and everything that happens to it lands on its timeline."}
          </p>
        ) : accounts !== null ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="services-accounts-table">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="py-2.5 pr-3">
                      <Link
                        href={`/Services/customers/${account.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {account.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{account.kind}</td>
                    <td className="py-2.5 pr-3 text-muted">{account.status}</td>
                    <td className="py-2.5 pr-3 text-muted">{account.source ?? "—"}</td>
                    <td className="py-2.5 text-muted">{account.updatedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
