"use client";

import { Bot, ExternalLink, Gauge, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AccountUsage, type AccountUsageView } from "@/components/bot-manager/account-usage";
import { BlockedState, Card, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Bot Usage, per the owner's 2026-08-17 design — restricted to what is
 * actually recorded. Providers report subscription windows as percentages
 * with their own reset times, not absolute request counts, so the bars here
 * are percent-based; each absence state names itself. The design's plan /
 * billing footer, date-range picker, and history tabs have no backing model
 * (observations surface latest-per-account) and are deliberately absent.
 */

type AccountView = {
  id: string;
  provider: string;
  providerLabel: string;
  displayName: string;
  status: string;
  lastVerifiedAt: string | null;
};

type State = "loading" | "signed-out" | "ready" | "error";

/**
 * Headroom banding derived from the highest provider-reported used-percent
 * across the account's windows — the same thresholds the usage bars color
 * by. A computed label over visible numbers, never a substitute for them.
 */
function headroom(usage: AccountUsageView | undefined):
  | { label: string; tone: "safe" | "warning" | "danger" }
  | null {
  if (!usage || usage.status !== "measured" || usage.windows.length === 0) return null;
  const highest = Math.max(...usage.windows.map((window) => window.usedPercent));
  if (highest >= 90) return { label: "Low headroom", tone: "danger" };
  if (highest >= 75) return { label: "Moderate", tone: "warning" };
  return { label: "Healthy", tone: "safe" };
}

export function BotUsageConsole() {
  const [state, setState] = useState<State>("loading");
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [usageByAccount, setUsageByAccount] = useState<Record<string, AccountUsageView>>({});
  const [canManage, setCanManage] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const accountsResponse = await fetch("/api/ai-accounts", { cache: "no-store" });
      if (accountsResponse.status === 401) {
        setState("signed-out");
        return;
      }
      if (!accountsResponse.ok) {
        const body = (await accountsResponse.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "AI accounts could not be loaded.");
      }
      const accountsBody = (await accountsResponse.json()) as { accounts?: AccountView[]; canManage?: boolean };
      setAccounts(accountsBody.accounts ?? []);
      setCanManage(Boolean(accountsBody.canManage));
      // Usage is separate evidence with its own lifecycle: a failed usage
      // read leaves each row saying "no usage recorded yet".
      try {
        const usageResponse = await fetch("/api/ai-accounts/usage", { cache: "no-store" });
        if (usageResponse.ok) {
          const usageBody = (await usageResponse.json()) as { usage?: AccountUsageView[] };
          setUsageByAccount(Object.fromEntries((usageBody.usage ?? []).map((entry) => [entry.accountId, entry])));
        }
      } catch {
        // Absence of usage evidence is not an outage.
      }
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI accounts could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    // The worker records fresh usage on its own cadence; re-read it while
    // the page is open so a completed sweep shows without a manual reload.
    const interval = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  const requestRefresh = useCallback(async () => {
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/ai-accounts/refresh", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The refresh could not be requested.");
      setNotice("Refresh requested. The worker re-verifies each account and records fresh usage on its next pass — this page re-reads automatically.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The refresh could not be requested.");
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (state === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading bot usage" />
      </Card>
    );
  }
  if (state === "signed-out") {
    return <BlockedState icon={Gauge} title="Sign in to see bot usage" description="Usage evidence belongs to your organization." href="/auth/sign-in?next=/solutions/bot-usage" label="Sign in" />;
  }
  if (state === "error") {
    return <BlockedState icon={Gauge} title="Bot usage is unavailable" description={message || "Usage could not be loaded."} href="/solutions/bot-manager" label="Open Bot Manager" />;
  }

  const connected = accounts.filter((account) => account.status === "connected");
  const measured = accounts.filter((account) => {
    const usage = usageByAccount[account.id];
    return usage?.status === "measured" && usage.windows.length > 0;
  });
  // The provider's whole-subscription weekly window, where reported.
  const weeklyPercents = measured
    .map((account) => usageByAccount[account.id]?.windows.find((window) => window.key === "week_all_models")?.usedPercent)
    .filter((value): value is number => typeof value === "number");
  const averageWeekly = weeklyPercents.length
    ? Math.round(weeklyPercents.reduce((sum, value) => sum + value, 0) / weeklyPercents.length)
    : null;

  if (!accounts.length) {
    return (
      <Card className="p-5 sm:p-6">
        <SectionTitle
          title="No AI accounts connected"
          description="Usage evidence appears here per connected account. Connect Claude or Codex on the Bot Manager first."
        />
        <Link href="/solutions/bot-manager#connect" className="btn btn-primary btn-sm mt-4">
          <Bot className="size-4" aria-hidden="true" />
          Connect a bot
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Provider-reported subscription windows per account, recorded by the automatic sweep.
        </p>
        {canManage ? (
          <button type="button" onClick={() => void requestRefresh()} disabled={refreshing} className="btn btn-secondary btn-sm">
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </button>
        ) : null}
      </div>
      {notice ? <p className="text-sm text-muted" aria-live="polite">{notice}</p> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm text-faint">Bots connected</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{connected.length}</p>
          <p className="mt-0.5 text-xs text-faint">
            {accounts.length - connected.length > 0
              ? `${accounts.length - connected.length} more need${accounts.length - connected.length === 1 ? "s" : ""} attention`
              : "every account is connected"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-faint">Average weekly usage</p>
          {averageWeekly !== null ? (
            <>
              <p className="mt-1 text-2xl font-semibold text-foreground">{averageWeekly}%</p>
              <p className="mt-0.5 text-xs text-faint">
                of the provider weekly window, across {weeklyPercents.length} bot{weeklyPercents.length === 1 ? "" : "s"} with measured usage
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold text-foreground">—</p>
              <p className="mt-0.5 text-xs text-faint">no measured weekly window yet</p>
            </>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--border)]">
          {accounts.map((account) => {
            const usage = usageByAccount[account.id];
            const band = headroom(usage);
            return (
              <li key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bot className="size-4 shrink-0 text-faint" aria-hidden="true" />
                    <p className="font-semibold text-foreground">{account.displayName}</p>
                    <span className="text-sm text-faint">{account.providerLabel}</span>
                    <StatusBadge tone={account.status === "connected" ? "safe" : "danger"} dot={false}>
                      {account.status === "connected" ? "Connected" : "Needs attention"}
                    </StatusBadge>
                    {band ? (
                      <span
                        className={cn(
                          "text-xs font-medium",
                          band.tone === "danger"
                            ? "text-[var(--danger)]"
                            : band.tone === "warning"
                              ? "text-[var(--warning)]"
                              : "text-accent",
                        )}
                      >
                        {band.label}
                      </span>
                    ) : null}
                  </div>
                  <AccountUsage usage={usage} />
                </div>
                <Link href="/solutions/bot-manager" className="btn btn-secondary btn-sm sm:shrink-0">
                  View details
                  <ExternalLink className="size-4" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-4">
        <p className="text-sm text-muted">
          Each window resets on the provider&apos;s own schedule — the reset time next to a bar is the
          provider&apos;s, not a plan setting. Session and weekly limits belong to the account&apos;s own
          subscription; SoftwareFactory records them and never bills on top.
        </p>
      </Card>
    </div>
  );
}
