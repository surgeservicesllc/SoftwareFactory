"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import type { JobView } from "@/components/job-seeker/jobs-panel";

/**
 * Follow-up: recorded contacts and outreach drafts for human review.
 * Contacts are recorded by the person, attributed to their source; drafts
 * are written from recorded facts. Nothing here sends anything — no send
 * integration exists, and the panel says so instead of pretending.
 */

type ContactView = {
  id: string;
  applicationId: string | null;
  name: string;
  role: string | null;
  source: string | null;
  linkedinUrl: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
};

type OutreachView = {
  id: string;
  contactId: string;
  applicationId: string | null;
  subject: string | null;
  body: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
};

const FIELD_CLASS =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-[var(--text)]">{label}</span>
      {children}
    </label>
  );
}

export function JobSeekerFollowUpPanel() {
  const [contacts, setContacts] = useState<ContactView[] | null>(null);
  const [outreach, setOutreach] = useState<OutreachView[]>([]);
  const [applications, setApplications] = useState<JobView[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [source, setSource] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [applicationId, setApplicationId] = useState("");

  const load = useCallback(async () => {
    try {
      const [contactsResponse, outreachResponse, jobsResponse] = await Promise.all([
        fetch("/api/job-seeker/contacts", { cache: "no-store" }),
        fetch("/api/job-seeker/outreach", { cache: "no-store" }),
        fetch("/api/job-seeker/jobs", { cache: "no-store" }),
      ]);
      if (!contactsResponse.ok || !outreachResponse.ok || !jobsResponse.ok) {
        setProblem("Follow-up data could not be loaded.");
        return;
      }
      const contactsBody = (await contactsResponse.json()) as { contacts?: ContactView[] };
      const outreachBody = (await outreachResponse.json()) as { outreach?: OutreachView[] };
      const jobsBody = (await jobsResponse.json()) as { jobs?: JobView[] };
      setContacts(contactsBody.contacts ?? []);
      setOutreach(outreachBody.outreach ?? []);
      setApplications((jobsBody.jobs ?? []).filter((job) => job.application));
    } catch {
      setProblem("Follow-up data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  async function addContact() {
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/job-seeker/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim() || null,
          source: source.trim() || null,
          linkedinUrl: linkedinUrl.trim() || null,
          applicationId: applicationId || null,
        }),
      });
      const body = (await response.json()) as { contact?: ContactView; error?: { message?: string } };
      if (!response.ok || !body.contact) {
        setProblem(body.error?.message ?? "The contact could not be saved.");
        return;
      }
      setContacts((current) => [body.contact as ContactView, ...(current ?? [])]);
      setName(""); setRole(""); setSource(""); setLinkedinUrl(""); setApplicationId("");
    } catch {
      setProblem("The contact could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function draftOutreach(contact: ContactView) {
    if (!contact.applicationId) {
      setProblem("Link the contact to an application to draft outreach for it.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/job-seeker/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, applicationId: contact.applicationId }),
      });
      const body = (await response.json()) as { outreach?: OutreachView; error?: { message?: string } };
      if (!response.ok || !body.outreach) {
        setProblem(body.error?.message ?? "The outreach draft could not be created.");
        return;
      }
      setOutreach((current) => [body.outreach as OutreachView, ...current]);
    } catch {
      setProblem("The outreach draft could not be created.");
    } finally {
      setBusy(false);
    }
  }

  if (contacts === null && !problem) {
    return (
      <Card className="min-h-48 animate-pulse">
        <span className="sr-only">Loading follow-up data</span>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="Follow-Up"
          description="Record the people behind an application and draft personalized outreach for your review. Nothing is ever sent from here — no send integration exists, and a draft says draft."
        />
        {problem ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{problem}</p> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Contact name">
            <input className={FIELD_CLASS} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Role">
            <input className={FIELD_CLASS} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <Field label="Where you found them">
            <input className={FIELD_CLASS} value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. company careers page" />
          </Field>
          <Field label="LinkedIn URL">
            <input className={FIELD_CLASS} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
          </Field>
          <Field label="Application">
            <select className={FIELD_CLASS} value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
              <option value="">Not linked yet</option>
              {applications.map((job) => (
                <option key={job.application!.id} value={job.application!.id}>
                  {job.title} — {job.company}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void addContact()}
              disabled={busy || !name.trim()}
            >
              {busy ? "Saving…" : "Save contact"}
            </button>
          </div>
        </div>
      </Card>

      {(contacts ?? []).length === 0 ? (
        <EmptyState
          title="No contacts recorded yet"
          description="Record a recruiter or hiring manager above; a contact linked to an application can have outreach drafted for your review."
        />
      ) : (
        (contacts ?? []).map((contact) => (
          <Card key={contact.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[var(--text)]">{contact.name}</h4>
                <p className="text-sm text-[var(--text-muted)]">
                  {[contact.role, contact.source ? `via ${contact.source}` : null].filter(Boolean).join(" · ") || "No role recorded"}
                </p>
                {contact.linkedinUrl ? (
                  <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] underline">
                    LinkedIn
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !contact.applicationId}
                title={contact.applicationId ? undefined : "Link the contact to an application first"}
                onClick={() => void draftOutreach(contact)}
              >
                Draft outreach
              </button>
            </div>

            {outreach.filter((draft) => draft.contactId === contact.id).map((draft) => (
              <div key={draft.id} className="mt-3 rounded-md border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--text)]">{draft.subject}</p>
                  <StatusBadge tone="neutral">{draft.status}</StatusBadge>
                </div>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-[var(--text)]">{draft.body}</pre>
                <p className="mt-2 text-xs text-[var(--text-faint)]">
                  For your review — copy it into your own email or LinkedIn. This system has no
                  send integration and will never claim a message was sent.
                </p>
              </div>
            ))}
          </Card>
        ))
      )}
    </div>
  );
}
