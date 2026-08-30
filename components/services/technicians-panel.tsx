"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { AccountAvatar } from "@/components/services/ui";
import type { TechniciansPayload } from "@/components/services/types";

/**
 * The technician roster: the licensed people who perform service. Adding
 * and correcting are real writes under RLS; there is no delete — a departed
 * technician is marked inactive, because completed visits and, in the
 * compliance increment, applicator records hang off them.
 */
export function ServicesTechniciansPanel() {
  const [payload, setPayload] = useState<TechniciansPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/services/technicians", {
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as TechniciansPayload & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setListError(body.error?.message ?? "Technicians could not be listed.");
        return;
      }
      setListError(null);
      setPayload(body);
    } catch {
      setListError("Technicians could not be listed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const create = useCallback(async () => {
    setBusy(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/services/technicians", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(licenseNumber.trim() ? { licenseNumber: licenseNumber.trim() } : {}),
        }),
      });
      const body = (await response.json()) as { technician?: unknown; error?: { message?: string } };
      if (!response.ok || !body.technician) {
        setCreateError(body.error?.message ?? "The technician could not be recorded.");
        return;
      }
      setFirstName("");
      setLastName("");
      setPhone("");
      setLicenseNumber("");
      void refresh();
    } catch {
      setCreateError("The request did not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [firstName, lastName, phone, licenseNumber, refresh]);

  const toggleActive = useCallback(
    async (technicianId: string, active: boolean) => {
      setActError(null);
      try {
        const response = await fetch(`/api/services/technicians/${technicianId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ active }),
        });
        if (!response.ok) {
          const body = (await response.json()) as { error?: { message?: string } };
          setActError(body.error?.message ?? "The change could not be recorded.");
          return;
        }
        void refresh();
      } catch {
        setActError("The request did not reach the server.");
      }
    },
    [refresh],
  );

  const technicians = payload?.technicians ?? null;

  return (
    <div>
      <PageHeader
        title="Technicians"
        description="The roster that performs service. License numbers feed the compliance reporting to come; history keeps everyone — a departure is marked inactive, never erased."
        action={
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="btn btn-primary px-3 py-2 text-sm"
          >
            {showForm ? "Close" : "Add technician"}
          </button>
        }
      />

      {showForm ? (
        <Card className="mb-6">
          <SectionTitle
            title="Add a technician"
            description="A real roster record in this workspace, assignable on the schedule immediately."
          />
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="block text-sm">
              <span className="text-muted">First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
                maxLength={100}
                className="input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Last name (optional)</span>
              <input
                type="text"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                maxLength={100}
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
            <label className="block text-sm">
              <span className="text-muted">Applicator license (optional)</span>
              <input
                type="text"
                value={licenseNumber}
                onChange={(event) => setLicenseNumber(event.target.value)}
                maxLength={120}
                placeholder="License number"
                className="input mt-1 w-full"
              />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy} className="btn btn-primary px-4 py-2 text-sm">
                {busy ? "Adding…" : "Add technician"}
              </button>
            </div>
          </form>
          {createError !== null ? (
            <div className="mt-3">
              <Notice tone="warning">{createError}</Notice>
            </div>
          ) : null}
        </Card>
      ) : null}

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}
      {actError !== null ? <Notice tone="warning">{actError}</Notice> : null}

      <Card>
        {technicians === null && listError === null ? (
          <p className="text-sm text-muted">Loading the roster…</p>
        ) : technicians !== null && technicians.length === 0 ? (
          <p className="text-sm text-muted" data-testid="services-technicians-empty">
            No technicians yet. Use Add technician above to record the first — they become
            assignable on the Schedule the moment they exist.
          </p>
        ) : technicians !== null ? (
          <ul className="divide-y divide-line" data-testid="services-technicians">
            {technicians.map((technician) => {
              const name = [technician.firstName, technician.lastName].filter(Boolean).join(" ");
              return (
                <li key={technician.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <AccountAvatar name={name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {name}
                      {technician.licenseNumber ? (
                        <span className="flex items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-surface)] px-2 py-0.5 text-xs font-medium text-[var(--accent-text)]">
                          <BadgeCheck className="size-3" aria-hidden="true" />
                          {technician.licenseNumber}
                        </span>
                      ) : null}
                      {technician.active ? null : (
                        <span className="rounded-full border border-line bg-surface-raised px-2 py-0.5 text-xs text-muted">
                          inactive
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted">
                      {[technician.email, technician.phone].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void toggleActive(technician.id, !technician.active)}
                    className="btn btn-secondary px-2.5 py-1 text-xs"
                  >
                    {technician.active ? "Mark inactive" : "Reactivate"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
