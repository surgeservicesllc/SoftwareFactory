"use client";

import { Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Card } from "@/components/ui";

export type DetailState<Item> =
  | { kind: "idle" }
  | { kind: "loading"; id: string }
  | { kind: "ready"; id: string; item: Item }
  | { kind: "error"; id: string; message: string };

export function useControlPlaneDetail<Item>(resource: string, key: string) {
  const [state, setState] = useState<DetailState<Item>>({ kind: "idle" });
  const requestVersion = useRef(0);

  const open = useCallback(async (id: string) => {
    const version = ++requestVersion.current;
    setState({ kind: "loading", id });
    try {
      const response = await fetch(`/api/${resource}/${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = (await response.json()) as Record<string, unknown> & { error?: { message?: string } };
      if (!response.ok || !body[key]) {
        throw new Error(body.error?.message ?? "Details could not be loaded.");
      }
      if (version === requestVersion.current) {
        setState({ kind: "ready", id, item: body[key] as Item });
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setState({
          kind: "error",
          id,
          message: error instanceof Error ? error.message : "Details could not be loaded.",
        });
      }
    }
  }, [key, resource]);

  return {
    state,
    open,
    close: () => {
      requestVersion.current += 1;
      setState({ kind: "idle" } as DetailState<Item>);
    },
    reload: () => state.kind === "idle" ? undefined : open(state.id),
  };
}

export function ControlPlaneDetail<Item>({
  state,
  title,
  onClose,
  onRetry,
  children,
}: {
  state: DetailState<Item>;
  title: string;
  onClose: () => void;
  onRetry: () => void;
  children: (item: Item) => React.ReactNode;
}) {
  if (state.kind === "idle") return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line p-4">
        <h2 className="font-semibold text-foreground">{title}</h2>
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" aria-label={`Close ${title.toLowerCase()}`}>
          <X className="size-4" aria-hidden="true" />
          Close
        </button>
      </div>
      {state.kind === "loading" ? (
        <div className="grid min-h-48 place-items-center">
          <Loader2 className="size-6 animate-spin text-accent" aria-label={`Loading ${title.toLowerCase()}`} />
        </div>
      ) : state.kind === "error" ? (
        <div className="grid min-h-48 place-items-center p-6 text-center">
          <div className="max-w-md">
            <p className="font-semibold text-foreground">{title} could not be loaded</p>
            <p className="mt-2 text-sm text-muted">{state.message}</p>
            <button type="button" onClick={onRetry} className="btn btn-primary mt-4">
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      ) : (
        children(state.item)
      )}
    </Card>
  );
}

export function DetailFacts({ facts }: { facts: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="card-inset min-w-0 p-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">{fact.label}</dt>
          <dd className="mt-1 break-words text-sm text-foreground">{fact.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalEvidenceLink({ href, children }: { href?: string | null; children: React.ReactNode }) {
  const safeHref = safeExternalHref(href);
  if (!safeHref) return <span>{children}</span>;
  return (
    <a href={safeHref} target="_blank" rel="noreferrer" className="font-medium text-accent-text underline underline-offset-4">
      {children}
    </a>
  );
}

function safeExternalHref(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
