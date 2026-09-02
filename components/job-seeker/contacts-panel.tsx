"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, User } from "lucide-react";

import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { RecruiterMessageCheck } from "@/components/job-seeker/message-check";

/**
 * The people behind the applications, and what has been written to them.
 *
 * Contacts and outreach are read together because neither is useful alone: a
 * contact with no message is a name, and a message with no contact is a draft
 * addressed to nobody. Outreach carries a status — draft, approved, sent —
 * and this shows it rather than implying everything written was delivered.
 */

type ContactView = {
  id: string;
  name: string;
  role: string | null;
  source: string | null;
  linkedinUrl: string | null;
  email: string | null;
  notes: string | null;
};

type OutreachView = {
  id: string;
  contactId: string | null;
  subject: string | null;
  body: string;
  status: string;
  sentAt: string | null;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; contacts: ContactView[]; outreach: OutreachView[] };

const STATUS_TONE: Record<string, "safe" | "info" | "neutral"> = {
  sent: "safe",
  approved: "info",
  draft: "neutral",
};

export function JobSeekerContactsPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const [contactsResponse, outreachResponse] = await Promise.allSettled([
        fetch("/api/job-seeker/contacts", { cache: "no-store" }),
        fetch("/api/job-seeker/outreach", { cache: "no-store" }),
      ]);
      if (contactsResponse.status !== "fulfilled" || !contactsResponse.value.ok) {
        setState({ kind: "error" });
        return;
      }
      const contactsBody = (await contactsResponse.value.json()) as { contacts?: ContactView[] };
      let outreach: OutreachView[] = [];
      if (outreachResponse.status === "fulfilled" && outreachResponse.value.ok) {
        const body = (await outreachResponse.value.json()) as { outreach?: OutreachView[] };
        outreach = body.outreach ?? [];
      }
      setState({ kind: "ready", contacts: contactsBody.contacts ?? [], outreach });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts & Outreach"
        description="The people behind your applications, and what has been written to them."
      />

      <RecruiterMessageCheck />

      {state.kind === "loading" ? (
        <Card className="grid min-h-40 place-items-center">
          <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading contacts" />
        </Card>
      ) : state.kind === "error" ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">Contacts could not be loaded</h2>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
            Try again
          </button>
        </Card>
      ) : (
        <>
          <section aria-label="Contacts">
            <h2 className="label">Contacts</h2>
            {state.contacts.length === 0 ? (
              <Card className="mt-2 p-5">
                <p className="max-w-2xl text-sm text-muted">
                  No contact recorded yet. Contacts are added against an application — the recruiter
                  or hiring manager for a specific role — so they stay attached to the job they
                  belong to.
                </p>
              </Card>
            ) : (
              <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {state.contacts.map((contact) => {
                  const messages = state.outreach.filter((entry) => entry.contactId === contact.id);
                  return (
                    <li key={contact.id}>
                      <Card className="p-4">
                        <div className="flex items-start gap-3">
                          <User className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{contact.name}</p>
                            <p className="truncate text-sm text-faint">
                              {contact.role ?? "Role not recorded"}
                            </p>
                          </div>
                          <StatusBadge tone={messages.length > 0 ? "info" : "neutral"} dot={false}>
                            {messages.length} message{messages.length === 1 ? "" : "s"}
                          </StatusBadge>
                        </div>
                        {contact.email || contact.linkedinUrl ? (
                          <p className="mt-2 truncate text-xs text-faint">
                            {[contact.email, contact.linkedinUrl].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {contact.notes ? (
                          <p className="mt-2 line-clamp-2 text-sm text-muted">{contact.notes}</p>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Outreach">
            <h2 className="label">Outreach</h2>
            {state.outreach.length === 0 ? (
              <Card className="mt-2 p-5">
                <p className="max-w-2xl text-sm text-muted">
                  Nothing written yet. A draft stays a draft until it is approved, and approved
                  until it is sent — this list shows which of the three each message is, so
                  &ldquo;did I send that?&rdquo; has an answer.
                </p>
              </Card>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {state.outreach.map((message) => (
                  <li key={message.id} className="flex flex-wrap items-center gap-2 py-3">
                    <Mail className="size-4 shrink-0 text-faint" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {message.subject ?? "No subject"}
                      </p>
                      <p className="truncate text-sm text-faint">{message.body.slice(0, 120)}</p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[message.status] ?? "neutral"} dot={false}>
                      {message.status === "sent" ? "Sent" : message.status === "approved" ? "Approved" : "Draft"}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
