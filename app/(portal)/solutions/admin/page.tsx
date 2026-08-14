import { ShieldCheck, ShieldX } from "lucide-react";

import { Card, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { superAdminEmails } from "@/lib/auth/super-admin";
import { readViewer } from "@/lib/auth/viewer";

export const metadata = {
  title: "Admin",
};

/**
 * The super-administrator surface.
 *
 * The check happens here, on the server, on every request. The navigation
 * entry is hidden for everyone else, but a hidden link is not access control —
 * typing the URL reaches this page, and this page is what refuses.
 */
export default async function AdminPage() {
  const viewer = await readViewer();

  if (!viewer.signedIn || !viewer.isSuperAdmin) {
    return (
      <>
        <PageHeader
          title="Admin"
          description="This area is limited to super administrators."
          action={<StatusBadge tone="danger">No access</StatusBadge>}
        />
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldX className="mt-0.5 size-5 shrink-0 text-[var(--danger)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {viewer.signedIn
                  ? "Your account does not hold the super-administrator role."
                  : "Sign in to continue."}
              </p>
              <p className="mt-2 text-sm text-muted">
                The role is granted by email address and requires that address to be
                confirmed. Nothing on this page is loaded for an account without it.
              </p>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const administrators = superAdminEmails();
  const configuredBy = process.env.SUPER_ADMIN_EMAILS
    ? "SUPER_ADMIN_EMAILS"
    : "the repository default";

  return (
    <>
      <PageHeader
        title="Admin"
        description="Super-administrator view of how access is granted in this workspace."
        action={<StatusBadge tone="safe">Super admin</StatusBadge>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-5 sm:p-6">
          <SectionTitle
            title="Your session"
            description="Verified against Supabase on this request, not read from a cookie."
          />
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="label mb-1">Signed in as</dt>
              <dd className="truncate text-sm text-foreground">{viewer.email}</dd>
            </div>
            <div>
              <dt className="label mb-1">Name</dt>
              <dd className="truncate text-sm text-foreground">
                {viewer.displayName ?? "Not set"}
              </dd>
            </div>
            <div>
              <dt className="label mb-1">Email confirmed</dt>
              <dd className="text-sm text-foreground">{viewer.emailConfirmed ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="label mb-1">Role</dt>
              <dd className="text-sm text-foreground">Super administrator</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <SectionTitle
            title="Who holds this role"
            description={`Configured by ${configuredBy}.`}
          />
          <ul className="mt-4 space-y-2">
            {administrators.map((email) => (
              <li
                key={email}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-foreground"
              >
                <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate">{email}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            Set the server-only <code className="font-mono text-xs">SUPER_ADMIN_EMAILS</code>{" "}
            variable to replace this list without a code change.
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-5 sm:p-6">
        <SectionTitle
          title="What this role does not bypass"
          description="Being a super administrator changes what you can see. It does not change what the system is allowed to do on its own."
        />
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            "Autonomous Mode stays OFF",
            "The global kill switch stays ON",
            "Row Level Security still applies to every query",
            "RED actions still require explicit owner approval",
            "Provider execution still needs its own switch",
            "Nothing merges, deploys, or runs without you",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
