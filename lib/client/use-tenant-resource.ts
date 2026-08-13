"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared client loader for tenant-scoped APIs.
 *
 * Every live surface distinguishes the same states, because they mean different
 * things to the reader: "you are signed out", "this tenant is not set up yet",
 * and "the source failed" must never collapse into an empty list that looks
 * like a confident zero.
 */

export type TenantLoadState = "loading" | "signed-out" | "setup" | "ready" | "error";

export type TenantResource<T> = {
  readonly state: TenantLoadState;
  readonly data: T | null;
  readonly message: string;
  readonly reload: () => void;
  readonly refreshing: boolean;
};

export function isBrowserSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    && (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    ),
  );
}

export function useTenantResource<T>(
  path: string | null,
  options: { pollMs?: number; enabled?: boolean } = {},
): TenantResource<T> {
  const supabaseConfigured = isBrowserSupabaseConfigured();
  const enabled = (options.enabled ?? true) && path !== null;
  const [state, setState] = useState<TenantLoadState>(() =>
    supabaseConfigured ? "loading" : "signed-out",
  );
  const [data, setData] = useState<T | null>(null);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    if (!supabaseConfigured) {
      setState("signed-out");
      return;
    }
    if (!enabled || !path) return;

    if (loadedOnce.current) setRefreshing(true);
    else setState("loading");
    setMessage("");

    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }

      const body = (await response.json()) as T & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "This live source is unavailable.");
      }

      setData(body);
      setState("ready");
      loadedOnce.current = true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This live source is unavailable.");
      setState("error");
    } finally {
      setRefreshing(false);
    }
  }, [enabled, path, supabaseConfigured]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, load]);

  useEffect(() => {
    // Polling keeps in-flight execution visible without holding a socket open.
    // Run state is durable in Postgres, so a missed poll changes nothing.
    if (!options.pollMs || !enabled) return;
    const interval = window.setInterval(() => void load(), options.pollMs);
    return () => window.clearInterval(interval);
  }, [enabled, load, options.pollMs]);

  return { state, data, message, reload: () => void load(), refreshing };
}

export async function postJson<T>(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<{ ok: boolean; status: number; body: T & { error?: { message?: string } } }> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const parsed = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  return { ok: response.ok, status: response.status, body: parsed };
}
