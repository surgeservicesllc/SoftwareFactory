"use client";

import { Gauge, MapPinned, SlidersHorizontal, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, MetricCard, PageHeader, SectionTitle } from "@/components/ui";
import {
  CRM_SCORING_MODELS,
  SCORING_MODEL_LABEL,
  signedPoints,
  type CrmScoringModel,
  type EffectiveRuleView,
  type ScoredAccountView,
} from "@/lib/services/scoring";

/**
 * Signals: lead score, churn risk and upsell — each a sum of named rules
 * with every point printed beside the fact that earned it. The rules are
 * the workspace's to change: points are editable, a rule can be switched
 * off, and resetting one deletes the override rather than writing the
 * default down as if it were a choice.
 */

type Board = {
  model: CrmScoringModel;
  rules: EffectiveRuleView[];
  accounts: ScoredAccountView[];
  counts: { scored: number; average: number | null; top: number | null; overridden: number };
};

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function ServicesScoringPanel() {
  const [model, setModel] = useState<CrmScoringModel>("lead");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { points: number; active: boolean }>>({});
  const [assigned, setAssigned] = useState<number | null>(null);

  const load = useCallback(async (which: CrmScoringModel) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/services/scoring?model=${which}`, { cache: "no-store" });
      if (!response.ok) {
        setLoadError(await readFailure(response, "Scores could not be computed."));
        return;
      }
      const body = (await response.json()) as Board;
      setBoard(body);
      setDrafts(Object.fromEntries(body.rules.map((rule) => [rule.ruleKey, { points: rule.points, active: rule.active }])));
    } catch {
      setLoadError("Scores could not be computed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(model), 0);
    return () => window.clearTimeout(kickoff);
  }, [load, model]);

  async function send(input: RequestInfo, init: RequestInit, failure: string): Promise<Response | null> {
    if (busy) return null;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(input, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });
      if (!response.ok) {
        setMessage(await readFailure(response, failure));
        return null;
      }
      return response;
    } catch {
      setMessage(failure);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveRule(rule: EffectiveRuleView) {
    const draft = drafts[rule.ruleKey];
    if (!draft) return;
    const ok = await send(
      "/api/services/scoring/rules",
      { method: "PUT", body: JSON.stringify({ model, ruleKey: rule.ruleKey, points: draft.points, active: draft.active }) },
      "The rule could not be saved.",
    );
    if (ok) await load(model);
  }

  async function resetRule(rule: EffectiveRuleView) {
    const ok = await send(
      "/api/services/scoring/rules",
      { method: "DELETE", body: JSON.stringify({ model, ruleKey: rule.ruleKey }) },
      "The rule could not be reset.",
    );
    if (ok) await load(model);
  }

  async function assignByPostal() {
    const response = await send(
      "/api/services/scoring/assign",
      { method: "POST", body: "{}" },
      "Accounts could not be assigned.",
    );
    if (!response) return;
    const body = (await response.json()) as { assigned: number };
    setAssigned(body.assigned);
  }

  const labels = SCORING_MODEL_LABEL[model];

  return (
    <div className="space-y-6" data-testid="services-signals">
      <PageHeader
        title="Signals"
        description="Lead score, churn risk and upsell — each a sum of named rules, every point printed with the fact that earned it. Computed from your records when you open the page; nothing is stored."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Model">
        {CRM_SCORING_MODELS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={candidate === model}
            className={
              candidate === model
                ? "rounded-full bg-[var(--accent)] px-3 py-1 text-sm text-white"
                : "rounded-full border border-[var(--border)] px-3 py-1 text-sm text-muted"
            }
            onClick={() => setModel(candidate)}
          >
            {SCORING_MODEL_LABEL[candidate].title}
          </button>
        ))}
      </div>

      {loadError ? <p role="alert" className="text-sm text-[var(--danger)]">{loadError}</p> : null}
      {message ? <p role="alert" className="text-sm text-[var(--danger)]">{message}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={`${labels.title}: scored`}
          value={loading ? "—" : String(board?.counts.scored ?? 0)}
          detail={`Every one of your ${labels.scores}`}
          icon={Users}
        />
        <MetricCard
          label="Highest"
          value={loading || board?.counts.top === null ? "—" : String(board?.counts.top ?? 0)}
          detail="The top score right now"
          icon={Gauge}
          tone="info"
        />
        <MetricCard
          label="Average"
          value={loading || board?.counts.average === null ? "—" : String(board?.counts.average ?? 0)}
          detail="Across everyone scored"
          icon={Gauge}
        />
        <MetricCard
          label="Rules changed"
          value={loading ? "—" : String(board?.counts.overridden ?? 0)}
          detail="Overrides from the defaults"
          icon={SlidersHorizontal}
        />
      </div>

      <Card>
        <SectionTitle title={labels.title} description={labels.description} />
        {loading ? (
          <p className="mt-3 text-sm text-muted">Computing from your records…</p>
        ) : (board?.accounts.length ?? 0) === 0 ? (
          <EmptyState
            title={`Nobody to score`}
            description={`There are no ${labels.scores} in this workspace yet.`}
            icon={Gauge}
          />
        ) : (
          <ol className="mt-3 divide-y divide-[var(--border)]" data-testid="signals-accounts">
            {board!.accounts.map((account) => (
              <li key={account.accountId} className="flex flex-wrap items-start gap-3 py-3">
                <span className="tabular w-12 shrink-0 text-2xl font-semibold" aria-label={`Score ${account.score}`}>
                  {account.score}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {account.name}
                    <span className="ml-2 text-xs text-faint">{account.kind} · {account.status}</span>
                  </p>
                  {account.breakdown.length === 0 ? (
                    <p className="mt-1 text-xs text-muted">No rule applies.</p>
                  ) : (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {account.breakdown.map((line) => (
                        <li
                          key={line.rule}
                          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-muted"
                          title={line.label}
                        >
                          <span className={line.points < 0 ? "text-[var(--danger)]" : "text-[var(--accent)]"}>
                            {signedPoints(line.points)}
                          </span>{" "}
                          {line.fact}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <SectionTitle
          title={`${labels.title}: the rules`}
          description="Change the points, switch a rule off, or reset it. The score above is recomputed from these the next time it is read."
        />
        {loading ? null : (
          <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="signals-rules">
            {(board?.rules ?? []).map((rule) => {
              const draft = drafts[rule.ruleKey] ?? { points: rule.points, active: rule.active };
              return (
                <li key={rule.ruleKey} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">
                    {rule.label}
                    {rule.overridden ? (
                      <span className="ml-2 text-xs text-faint">default {signedPoints(rule.defaultPoints)}</span>
                    ) : null}
                  </span>
                  <input
                    aria-label={`Points for ${rule.label}`}
                    type="number"
                    min={-100}
                    max={100}
                    className="w-20 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                    value={draft.points}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [rule.ruleKey]: { ...draft, points: Number(event.target.value) },
                      }))}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="checkbox"
                      aria-label={`${rule.label} is on`}
                      checked={draft.active}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [rule.ruleKey]: { ...draft, active: event.target.checked },
                        }))}
                    />
                    on
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                    onClick={() => void saveRule(rule)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy || !rule.overridden}
                    className="rounded border border-[var(--border)] px-3 py-1 text-xs text-muted disabled:opacity-50"
                    onClick={() => void resetRule(rule)}
                  >
                    Reset
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Assignment by postal code"
          description="A new account whose billing address carries a postal code inside a territory's coverage is assigned that territory, its branch and its rep on creation, with a history line saying which postal code matched. This runs the same match over every account that still has no territory."
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => void assignByPostal()}
          >
            <MapPinned className="mr-1 inline size-4" aria-hidden="true" />
            Assign unassigned accounts
          </button>
          {assigned !== null ? (
            <p className="text-sm text-muted" role="status">
              {assigned === 0
                ? "Nothing assigned: no unassigned account carries a postal code inside a territory's coverage."
                : `${assigned} account${assigned === 1 ? "" : "s"} assigned, each with a line on its history.`}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
