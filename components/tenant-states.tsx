"use client";

import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Panel } from "@/components/ui";
import type { TenantLoadState } from "@/lib/client/use-tenant-resource";

/**
 * The shared loading, signed-out, setup, and error surfaces.
 *
 * These states are distinct on purpose. An empty list after a failed fetch and
 * an empty list because there is genuinely nothing look identical to a reader
 * unless the difference is stated.
 */

export function TenantNotice({
  title,
  description,
  href,
  label,
  icon: Icon = AlertTriangle,
}: {
  title: string;
  description: string;
  href?: string;
  label?: string;
  icon?: LucideIcon;
}) {
  return (
    <Panel className="grid min-h-48 place-items-center p-6 text-center">
      <div className="max-w-md">
        <Icon className="mx-auto size-7 text-[#71802c]" aria-hidden="true" />
        <h2 className="mt-4 text-base font-semibold text-white">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-[#748191]">{description}</p>
        {href && label ? (
          <Link href={href} className="primary-action mt-4 justify-center">
            {label}
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}

export function TenantLoading({ label }: { label: string }) {
  return (
    <Panel className="grid min-h-48 place-items-center">
      <Loader2 className="size-6 animate-spin text-[#c6f135]" aria-label={label} />
    </Panel>
  );
}

/**
 * Renders the non-ready state for a tenant surface.
 *
 * Callers must branch on `state !== "ready"` themselves and render this only
 * then — a rendered element is always truthy, so it cannot be used as the
 * condition itself.
 */
export function TenantStateGate({
  state,
  message,
  subject,
  next,
}: {
  state: TenantLoadState;
  message: string;
  subject: string;
  next: string;
}) {
  if (state === "loading") return <TenantLoading label={`Loading ${subject}`} />;
  if (state === "signed-out") {
    return (
      <TenantNotice
        title={`Sign in to view ${subject}`}
        description="This surface is available only to authenticated members of the active organization."
        href={`/sign-in?next=${encodeURIComponent(next)}`}
        label="Sign in"
      />
    );
  }
  if (state === "setup") {
    return (
      <TenantNotice
        title="Select an organization"
        description="Complete onboarding or choose an active organization before loading tenant records."
        href="/connections"
        label="Open connections"
      />
    );
  }
  if (state === "error") {
    return (
      <TenantNotice
        title={`${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be loaded`}
        description={message || "The live source is unavailable. Nothing is inferred from a failed read."}
        href="/connections"
        label="Review connections"
      />
    );
  }
  return null;
}

export function EmptyPanel({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="grid min-h-48 place-items-center p-6 text-center">
      <div className="max-w-md">
        <Icon className="mx-auto size-7 text-[#566271]" aria-hidden="true" />
        <p className="mt-3 text-xs font-semibold text-[#c7cfd8]">{title}</p>
        <p className="mt-1 text-[10px] leading-5 text-[#667485]">{description}</p>
      </div>
    </div>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function formatDuration(milliseconds: number | null | undefined) {
  if (milliseconds === null || milliseconds === undefined) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function riskTone(risk: string): "safe" | "warning" | "danger" {
  return risk.toLowerCase() === "green" ? "safe" : risk.toLowerCase() === "yellow" ? "warning" : "danger";
}

export function runStatusTone(status: string): "safe" | "info" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "succeeded":
      return "safe";
    case "running":
    case "validating":
      return "info";
    case "queued":
    case "awaiting_review":
    case "cancelling":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}
