"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { dollars } from "@/components/services/ui";
import type {
  AttributionPayload,
  AutomationsPayload,
  CampaignsPayload,
  MarketingListsPayload,
} from "@/components/services/types";
import { cn } from "@/lib/cn";

/**
 * The marketing hub: lists and the consent on them, campaigns and the
 * message log they produced, the rules someone wrote, and where customers
 * came from.
 *
 * NOTHING HERE SENDS ANYTHING AND NOTHING RUNS THE RULES. No email or SMS
 * provider is connected and no executor exists, and this page says so at
 * the top rather than letting a green badge imply otherwise. Every figure
 * below is a record of what was written down, not evidence that it left the
 * building.
 *
 * Two honesty rules, the same ones the sales board uses: a rate over
 * nothing is shown as "nothing sent yet" rather than 0%, and unsubscribes
 * are reported beside subscribers rather than netted out of them.
 */

const CAMPAIGN_TONES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  scheduled: "border-sky-200 bg-sky-50 text-sky-700",
  sending: "border-amber-200 bg-amber-50 text-amber-700",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

type Tab = "lists" | "campaigns" | "automations" | "attribution";

export function ServicesMarketingPanel() {
  const [lists, setLists] = useState<MarketingListsPayload | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignsPayload | null>(null);
  const [automations, setAutomations] = useState<AutomationsPayload | null>(null);
  const [attribution, setAttribution] = useState<AttributionPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("campaigns");

  const refresh = useCallback(async () => {
    try {
      const [listsRes, campaignsRes, automationsRes, attributionRes] = await Promise.all([
        fetch("/api/services/marketing/lists", { headers: { accept: "application/json" } }),
        fetch("/api/services/marketing/campaigns", { headers: { accept: "application/json" } }),
        fetch("/api/services/marketing/automations", { headers: { accept: "application/json" } }),
        fetch("/api/services/attribution", { headers: { accept: "application/json" } }),
      ]);
      const body = (await campaignsRes.json()) as CampaignsPayload & { error?: { message?: string } };
      if (!campaignsRes.ok) {
        setListError(body.error?.message ?? "Marketing could not be read.");
        return;
      }
      setListError(null);
      setCampaigns(body);
      if (listsRes.ok) setLists((await listsRes.json()) as MarketingListsPayload);
      if (automationsRes.ok) setAutomations((await automationsRes.json()) as AutomationsPayload);
      if (attributionRes.ok) setAttribution((await attributionRes.json()) as AttributionPayload);
    } catch {
      setListError("Marketing could not be read.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(kickoff);
  }, [refresh]);

  const listName = useMemo(() => {
    const map = new Map<string, string>();
    for (const list of lists?.lists ?? []) map.set(list.id, list.name);
    return map;
  }, [lists]);

  const sources = useMemo(() => {
    const first = attribution?.firstTouch ?? {};
    const last = attribution?.lastTouch ?? {};
    return Array.from(new Set([...Object.keys(first), ...Object.keys(last)]))
      .map((source) => ({ source, first: first[source] ?? 0, last: last[source] ?? 0 }))
      .sort((left, right) => right.first + right.last - (left.first + left.last));
  }, [attribution]);

  return (
    <div>
      <PageHeader
        title="Marketing"
        description="Lists, consent, campaigns, the rules someone wrote, and where customers came from."
      />

      <Notice tone="info">
        <strong>Not Connected.</strong> No email or SMS provider is wired to this workspace and no
        executor runs the automation rules, so nothing on this page has been sent and no rule has
        fired. Everything below is what was recorded, not evidence that it left the building.
      </Notice>

      {listError !== null ? <Notice tone="warning">{listError}</Notice> : null}

      <div className="mb-4 mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Marketing records">
        {(
          [
            ["campaigns", "Campaigns", campaigns?.campaigns.length],
            ["lists", "Lists & consent", lists?.lists.length],
            ["automations", "Automations", automations?.automations.length],
            ["attribution", "Attribution", attribution?.counts.total],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("btn px-3 py-2 text-sm", tab === key ? "btn-primary" : "btn-secondary")}
          >
            {label}
            {typeof count === "number" ? <span className="ml-1.5 text-xs opacity-70">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "campaigns" ? (
        <Card>
          <SectionTitle
            title="Campaigns"
            description="The funnel only runs one way: a click implies an open, an open implies delivery, delivery implies a send. Those are the database's CHECKs, so a reported open rate cannot exceed the delivery it came from."
          />
          {(campaigns?.campaigns ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted" data-testid="services-marketing-empty">
              No campaigns yet. Draft one against a list — it stays a draft until a provider is
              connected.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-campaigns-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Campaign</th>
                    <th className="py-2 pr-3 font-medium">List</th>
                    <th className="py-2 pr-3 font-medium">Channel</th>
                    <th className="py-2 pr-3 font-medium">Recorded</th>
                    <th className="py-2 pr-3 font-medium">Open / click</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(campaigns?.campaigns ?? []).slice(0, 100).map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-foreground">{campaign.name}</span>
                        {campaign.subject ? (
                          <span className="block text-xs text-faint">{campaign.subject}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">
                        {campaign.listId === null ? "—" : (listName.get(campaign.listId) ?? "—")}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{campaign.channel}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {campaign.sent} sent
                        <span className="block text-xs text-faint">
                          {campaign.delivered} delivered · {campaign.failed} failed
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {campaign.openRate === null ? (
                          <span className="text-faint">nothing delivered</span>
                        ) : (
                          `${campaign.openRate}%`
                        )}
                        <span className="block text-xs text-faint">
                          {campaign.clickRate === null ? "no opens" : `${campaign.clickRate}% clicked`}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            CAMPAIGN_TONES[campaign.status] ?? CAMPAIGN_TONES.draft,
                          )}
                        >
                          {campaign.status}
                        </span>
                        {campaign.budgetCents !== null ? (
                          <span className="block text-xs text-faint">{dollars(campaign.budgetCents)}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "lists" ? (
        <Card>
          <SectionTitle
            title="Lists and consent"
            description="An unsubscribe keeps the moment it happened and the reason given. Withdrawn consent is reported beside the subscribers, never netted out of them."
          />
          {(lists?.lists ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No lists yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-lists-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">List</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Subscribers</th>
                    <th className="py-2 pr-3 font-medium">Unsubscribed</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(lists?.lists ?? []).slice(0, 100).map((list) => (
                    <tr key={list.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block font-medium text-foreground">{list.name}</span>
                        {list.criteria ? (
                          <span className="block font-mono text-xs text-faint">{list.criteria}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{list.isDynamic ? "dynamic" : "static"}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-foreground">{list.subscriberCount}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-amber-700">{list.unsubscribedCount}</td>
                      <td className="py-2.5 text-muted">{list.active ? "active" : "retired"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "automations" ? (
        <Card>
          <SectionTitle
            title="Automations"
            description="A rule is written down switched off. Arming something that will act on real customers is a deliberate second step — and no executor runs them yet, so an armed rule has still never fired."
          />
          {(automations?.automations ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted">No rules yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-automations-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Rule</th>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Then</th>
                    <th className="py-2 pr-3 font-medium">Delay</th>
                    <th className="py-2 font-medium">Armed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(automations?.automations ?? []).slice(0, 100).map((automation) => (
                    <tr key={automation.id}>
                      <td className="py-2.5 pr-3 font-medium text-foreground">{automation.name}</td>
                      <td className="py-2.5 pr-3 text-muted">
                        {automation.triggerOn.replace(/_/g, " ")}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{automation.action.replace(/_/g, " ")}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">
                        {automation.delayHours === 0 ? "immediately" : `${automation.delayHours}h`}
                      </td>
                      <td className="py-2.5 text-muted">
                        {automation.active ? "armed" : "off"}
                        <span className="block text-xs text-faint">
                          {automation.runCount === 0 ? "never run" : `${automation.runCount} runs`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "attribution" ? (
        <Card>
          <SectionTitle
            title="Attribution"
            description="First touch and last touch, side by side. Neither is called the answer — every attribution model is a choice, and hiding the choice behind one number is how these reports mislead."
          />
          {sources.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No touches recorded yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="services-attribution-table">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">First touch</th>
                    <th className="py-2 font-medium">Last touch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sources.map((row) => (
                    <tr key={row.source}>
                      <td className="py-2.5 pr-3 font-medium capitalize text-foreground">{row.source}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted">{row.first}</td>
                      <td className="py-2.5 tabular-nums text-muted">{row.last}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-faint">
                {attribution?.counts.total ?? 0} touches across {attribution?.counts.accounts ?? 0}{" "}
                customers.
              </p>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
