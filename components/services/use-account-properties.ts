"use client";

import { useEffect, useState } from "react";

import type { AccountDetailPayload, PropertyView } from "@/components/services/types";

/**
 * Fetches the chosen account's properties so a form's site select offers a
 * real site. The list is keyed to the account it was loaded for, so
 * switching accounts shows an empty select until the right list arrives —
 * never a stale one.
 */
export function useAccountProperties(accountId: string): PropertyView[] {
  const [loaded, setLoaded] = useState<{ forAccount: string; list: PropertyView[] }>({
    forAccount: "",
    list: [],
  });
  useEffect(() => {
    if (accountId === "") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/services/accounts/${accountId}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as AccountDetailPayload;
        setLoaded({ forAccount: accountId, list: body.properties });
      } catch {
        /* the select simply stays empty; the submit will say why */
      }
    })();
    return () => controller.abort();
  }, [accountId]);
  return loaded.forAccount === accountId ? loaded.list : [];
}
