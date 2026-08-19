"use client";

import { ArrowRight, Loader2, RefreshCw, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatDateTime } from "@/lib/format/date";
import { BlockedState, Card, StatusBadge } from "@/components/ui";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/browser-config";

/**
 * Every live surface answers the same questions: are you signed in, do you
 * have an organization, did the read fail, and is there anything here yet?
 * Getting one of those wrong is how a page ends up implying data exists when
 * it does not, so the state machine lives here once.
 *
 * There is deliberately no demo fallback. When a table is empty the page says
 * it is empty; it never substitutes illustrative rows for live ones.
 */

export type TenantListState<Item> =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "setup" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: Item[] };

export function useTenantList<Item>(
  path: string,
  pick: (body: Record<string, unknown>) => Item[],
  unavailableMessage: string,
  enabled = true,
) {
  const configured = isBrowserSupabaseConfigured();
  const canLoad = configured && enabled;
  const [state, setState] = useState<TenantListState<Item>>(
    () => canLoad ? { kind: "loading" } : { kind: "signed-out" },
  );

  const load = useCallback(async () => {
    // Without browser Supabase configuration the request can only fail, so
    // present the sign-in path instead of a failed call and a broken page.
    if (!canLoad) return setState({ kind: "signed-out" });
    setState({ kind: "loading" });
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.status === 401) return setState({ kind: "signed-out" });
      if (response.status === 409 || response.status === 403) return setState({ kind: "setup" });
      const body = (await response.json()) as Record<string, unknown> & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? unavailableMessage);
      setState({ kind: "ready", items: pick(body) });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : unavailableMessage,
      });
    }
    // `pick` is defined inline by callers; depending on it would reload forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, path, unavailableMessage]);

  useEffect(() => {
    if (!canLoad) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [canLoad, load]);

  return { state, reload: load };
}

export function TenantListShell<Item>({
  state,
  reload,
  title,
  icon,
  signedOutTitle,
  signedOutDescription,
  returnPath,
  emptyTitle,
  emptyDescription,
  emptyActionHref,
  emptyActionLabel,
  children,
  action,
}: {
  state: TenantListState<Item>;
  reload: () => void;
  title: string;
  icon: LucideIcon;
  signedOutTitle: string;
  signedOutDescription: string;
  returnPath: string;
  emptyTitle: string;
  emptyDescription: string;
  /**
   * Where a person goes to make this page non-empty, and what that step is
   * called. An empty page that only describes its emptiness is a dead end:
   * the reader has to already know which other page creates the thing. Both
   * are optional so a page with no such step stays honest rather than
   * inventing one.
   */
  emptyActionHref?: string;
  emptyActionLabel?: string;
  children: (items: Item[]) => React.ReactNode;
  action?: React.ReactNode;
}) {
  if (state.kind === "signed-out") {
    return (
      <BlockedState
        icon={icon}
        title={signedOutTitle}
        description={signedOutDescription}
        href={`/auth/sign-in?next=${encodeURIComponent(returnPath)}`}
        label="Sign in"
      />
    );
  }

  if (state.kind === "setup") {
    return (
      <BlockedState
        icon={icon}
        title="Choose a workspace"
        description="Finish setup or pick an active workspace to load this data."
        href="/solutions/connections"
        label="Open connections"
      />
    );
  }

  if (state.kind === "error") {
    return <BlockedState icon={icon} title={`${title} could not be loaded`} description={state.message} />;
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <StatusBadge tone={state.kind === "ready" ? "safe" : "neutral"}>
            {state.kind === "ready" ? "Live" : "Loading"}
          </StatusBadge>
        </div>
        <div className="flex items-center gap-2">
          {action}
          <button
            type="button"
            onClick={reload}
            disabled={state.kind === "loading"}
            className="btn btn-secondary btn-sm"
            aria-label={`Refresh ${title.toLowerCase()}`}
          >
            {state.kind === "loading"
              ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="size-4" aria-hidden="true" />}
            Refresh
          </button>
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="grid min-h-48 place-items-center">
          <Loader2 className="size-6 animate-spin text-accent" aria-label={`Loading ${title.toLowerCase()}`} />
        </div>
      ) : state.items.length ? (
        children(state.items)
      ) : (
        <div className="grid min-h-48 place-items-center p-8 text-center">
          <div className="max-w-sm">
            <p className="font-semibold text-foreground">{emptyTitle}</p>
            <p className="mt-2 text-sm text-muted">{emptyDescription}</p>
            {emptyActionHref && emptyActionLabel ? (
              <Link href={emptyActionHref} className="btn btn-primary btn-sm mt-4">
                {emptyActionLabel}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}

export function riskTone(risk: string) {
  const normalized = risk.toLowerCase();
  return normalized === "green" ? "safe" : normalized === "yellow" ? "warning" : "danger";
}

/** Re-exported so existing callers keep their import; the logic is shared. */
export { formatDateTime };

export function formatDuration(ms: number | null) {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
