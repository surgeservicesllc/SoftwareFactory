"use client";

import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BlockedState, Card, NotConnectedBadge, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The organization's plan, its real month-to-date usage, and the two money
 * actions: upgrade (Stripe Checkout) and manage (Stripe customer portal).
 * Every number renders from /api/billing/summary; when payments are not
 * configured the page says Not Connected instead of showing buttons that
 * could not charge.
 */

type Summary = {
  connected: boolean;
  plan: {
    key: string;
    name: string;
    limits: { maxProjects: number; graphLaunchesPerMonth: number; maxSeats: number };
  };
  subscription: {
    planKey: string;
    status: string;
    cadence: "monthly" | "yearly";
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  usage: { projects: number; graphLaunchesThisMonth: number; seats: number };
  role: string;
};

type State = "loading" | "signed-out" | "error" | "ready";

/** Limits at or above this render as "Unlimited" rather than a scary number. */
const DISPLAY_UNLIMITED = 100_000;

function limitLabel(limit: number): string {
  return limit >= DISPLAY_UNLIMITED ? "Unlimited" : String(limit);
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= DISPLAY_UNLIMITED;
  const percent = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-violet-500";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-slate-300">{label}</span>
        <span className="text-sm font-medium text-white">
          {used} <span className="text-slate-400">/ {limitLabel(limit)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-800" role="presentation">
        {unlimited ? null : (
          <div className={cn("h-2 rounded-full transition-all", tone)} style={{ width: `${percent}%` }} />
        )}
      </div>
    </div>
  );
}

export function BillingConsole() {
  const [state, setState] = useState<State>("loading");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("");
  const [cadence, setCadence] = useState<"monthly" | "yearly">("monthly");
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/summary", { credentials: "include" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setMessage(body?.error?.message ?? "Billing state could not be read.");
        setState("error");
        return;
      }
      setSummary((await response.json()) as Summary);
      setState("ready");
    } catch {
      setMessage("Billing state could not be read.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick, matching the other consoles: the lint rule cannot see
    // through an async boundary, and the page renders its loading state first
    // either way.
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const startAction = useCallback(
    async (endpoint: "checkout" | "portal", body?: Record<string, string>) => {
      setPending(body?.plan ?? endpoint);
      setMessage("");
      try {
        const response = await fetch(`/api/billing/${endpoint}`, {
          method: "POST",
          credentials: "include",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = (await response.json().catch(() => null)) as
          | { url?: string; error?: { message?: string } }
          | null;
        if (!response.ok || !payload?.url) {
          setMessage(payload?.error?.message ?? "The billing action failed.");
          setPending(null);
          return;
        }
        window.location.assign(payload.url);
      } catch {
        setMessage("The billing action failed.");
        setPending(null);
      }
    },
    [],
  );

  if (state === "loading") {
    return (
      <Card className="flex items-center gap-3 p-6 text-slate-300">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading billing state…
      </Card>
    );
  }
  if (state === "signed-out") {
    return <BlockedState title="Sign in required" description="Sign in to see your organization's plan." />;
  }
  if (state === "error" || !summary) {
    return <BlockedState title="Billing unavailable" description={message || "Billing state could not be read."} />;
  }

  const { plan, subscription, usage, connected, role } = summary;
  const canManage = role === "owner" || role === "admin";
  const onPaidPlan = subscription !== null;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle title="Current plan" />
            <p className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-white">
              {plan.name}
              {subscription ? (
                <StatusBadge
                  tone={subscription.status === "active" || subscription.status === "trialing" ? "safe" : "warning"}
                >
                  {subscription.status}
                </StatusBadge>
              ) : null}
              {!connected ? <NotConnectedBadge /> : null}
            </p>
            {subscription?.currentPeriodEnd ? (
              <p className="mt-1 text-sm text-slate-400">
                {subscription.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()} ·{" "}
                {subscription.cadence === "yearly" ? "billed yearly" : "billed monthly"}
              </p>
            ) : null}
            {!connected ? (
              <p className="mt-2 max-w-xl text-sm text-slate-400">
                Payments are Not Connected on this deployment: no Stripe keys are configured, so
                plans cannot be purchased here yet. Every organization runs on the Free plan&apos;s
                limits until payments are connected.
              </p>
            ) : null}
          </div>
          <CreditCard className="size-8 text-violet-400" aria-hidden="true" />
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <SectionTitle title="Usage this month" />
        <Meter label="Projects" used={usage.projects} limit={plan.limits.maxProjects} />
        <Meter
          label="Graph launches (this calendar month, UTC)"
          used={usage.graphLaunchesThisMonth}
          limit={plan.limits.graphLaunchesPerMonth}
        />
        <Meter label="Members" used={usage.seats} limit={plan.limits.maxSeats} />
        <p className="text-xs text-slate-500">
          Limits gate new work only — nothing already created stops when a limit is reached.
        </p>
      </Card>

      {connected && canManage ? (
        <Card className="space-y-4 p-6">
          <SectionTitle title={onPaidPlan ? "Manage subscription" : "Upgrade"} />
          {message ? <p className="text-sm text-red-400">{message}</p> : null}
          {onPaidPlan ? (
            <button
              type="button"
              onClick={() => void startAction("portal")}
              disabled={pending !== null}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pending === "portal" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Manage billing on Stripe
              <ExternalLink className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setCadence("monthly")}
                  className={cn(
                    "rounded-lg border px-3 py-1.5",
                    cadence === "monthly"
                      ? "border-violet-500 text-white"
                      : "border-slate-700 text-slate-400",
                  )}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCadence("yearly")}
                  className={cn(
                    "rounded-lg border px-3 py-1.5",
                    cadence === "yearly"
                      ? "border-violet-500 text-white"
                      : "border-slate-700 text-slate-400",
                  )}
                >
                  Yearly
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {(["basic", "pro"] as const).map((planKey) => (
                  <button
                    key={planKey}
                    type="button"
                    onClick={() => void startAction("checkout", { plan: planKey, cadence })}
                    disabled={pending !== null}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold capitalize text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {pending === planKey ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                    Upgrade to {planKey}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Checkout opens on Stripe. Card details never touch this site.
              </p>
            </>
          )}
        </Card>
      ) : null}

      <p className="text-sm text-slate-400">
        Full plan comparison on the{" "}
        <Link href="/pricing" className="text-violet-400 underline-offset-2 hover:underline">
          pricing page
        </Link>
        .
      </p>
    </div>
  );
}
