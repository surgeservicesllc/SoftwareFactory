"use client";

import { Bot } from "lucide-react";
import Link from "next/link";

import { TenantListShell, formatDateTime, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Command = {
  id: string;
  prompt: string;
  risk: string;
  status: string;
  submittedAt: string;
  completedAt: string | null;
  project: { id: string; name: string } | null;
};

function statusTone(status: string) {
  if (status === "succeeded") return "safe";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "awaiting_approval") return "warning";
  return "neutral";
}

/**
 * What a status means for the person who saved the request, and whether
 * watching it happen is possible yet.
 *
 * A saved request used to show only its raw status — "queued" — with nowhere
 * to go, which is exactly where the owner asked "how can I see it is working,
 * where is the readout?" on 2026-08-16. The status word is accurate; it was
 * never the answer to that question.
 */
export function commandProgress(status: string): { hint: string; trackable: boolean } {
  switch (status) {
    case "submitted":
      return { hint: "Saved. It is being checked before it can be queued.", trackable: false };
    case "awaiting_approval":
      return { hint: "Waiting for your approval — high-risk work never runs without it.", trackable: false };
    case "queued":
      return { hint: "Waiting for a worker to pick it up.", trackable: true };
    case "running":
      return { hint: "A bot is working on this now.", trackable: true };
    case "succeeded":
      return { hint: "Finished. Its evidence is on the run.", trackable: true };
    case "failed":
      return { hint: "Stopped before finishing. The run says why, and it can be retried.", trackable: true };
    case "cancelled":
      return { hint: "Cancelled before it finished.", trackable: true };
    default:
      return { hint: "", trackable: false };
  }
}

export function CommandsConsole({ refreshToken }: { refreshToken?: number }) {
  const { state, reload } = useTenantList<Command>(
    // The token is part of the path key so saving a new request re-reads the
    // list without the console needing to know how the composer works.
    `/api/commands${refreshToken ? `?limit=50&_=${refreshToken}` : ""}`,
    (body) => (body.commands as Command[]) ?? [],
    "Saved requests could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Your requests"
      icon={Bot}
      signedOutTitle="Sign in to see your requests"
      signedOutDescription="Saved requests belong to your workspace."
      returnPath="/solutions/bot-manager"
      emptyTitle="No requests yet"
      emptyDescription="Save your first request above and it will appear here with its risk level and status."
    >
      {(commands) => (
        <ul className="divide-y divide-[var(--border)]">
          {commands.map((command) => (
            <li key={command.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                {/* The prompt is owner-typed (a pasted URL is common); an
                    unbroken token must wrap rather than scroll the phone. */}
                <p className="break-words font-medium text-foreground">{command.prompt}</p>
                <p className="mt-0.5 text-sm text-faint">
                  {command.project?.name ?? "No project"} · saved {formatDateTime(command.submittedAt)}
                </p>
                {commandProgress(command.status).hint ? (
                  <p className="mt-1 text-sm text-muted">
                    {commandProgress(command.status).hint}
                    {commandProgress(command.status).trackable ? (
                      <>
                        {" "}
                        <Link
                          href="/solutions/runs"
                          className="font-medium text-accent-text underline underline-offset-4"
                        >
                          Watch it on Runs
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <StatusBadge tone={riskTone(command.risk)}>{command.risk.toUpperCase()}</StatusBadge>
                <StatusBadge tone={statusTone(command.status)} dot={false}>
                  {command.status.replace(/_/g, " ")}
                </StatusBadge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}
