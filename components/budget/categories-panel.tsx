"use client";

import { useCallback, useEffect, useState } from "react";
import type { CategoryView } from "@/components/budget/types";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { formatCents, parseMoneyToCents } from "@/lib/budget/money";

/**
 * Categories, editable at last.
 *
 * The rows were always written and read — the ledger and the import path
 * both classify against them — but nothing let a person rename one, move
 * its monthly ceiling, or retire it. Kind is not editable here on purpose:
 * history was classified under it, and the API refuses the field.
 * Archiving replaces deletion for the same reason — a deleted category
 * would strip the classification off every past row that used it.
 */

const KINDS = ["income", "expense", "transfer", "debt", "savings"] as const;
const TONES = [
  "neutral",
  "income",
  "essential",
  "discretionary",
  "debt",
  "savings",
  "warning",
] as const;

type Draft = { name: string; tone: string; limit: string };

export function BudgetCategoriesPanel() {
  const [categories, setCategories] = useState<readonly CategoryView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", tone: "neutral", limit: "" });
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<(typeof KINDS)[number]>("expense");
  const [newTone, setNewTone] = useState<(typeof TONES)[number]>("neutral");
  const [newLimit, setNewLimit] = useState("");
  const [planMonth, setPlanMonth] = useState(`${new Date().toISOString().slice(0, 7)}-01`);
  const [comparisons, setComparisons] = useState<ReadonlyArray<{
    categoryId: string;
    plannedCents: number;
    spentCents: number;
    remainingCents: number;
    overspent: boolean;
  }>>([]);
  const [planDrafts, setPlanDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/budget/categories", { cache: "no-store" });
      if (!response.ok) {
        setState("error");
        setMessage("Your categories could not be loaded. Reload to try again.");
        return;
      }
      const body = (await response.json()) as { categories?: CategoryView[] };
      setCategories(body.categories ?? []);
      setState("ready");
    } catch {
      setState("error");
      setMessage("Your categories could not be loaded. Reload to try again.");
    }
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      const response = await fetch(`/api/budget/plans?month=${planMonth}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { comparisons?: typeof comparisons };
      setComparisons(body.comparisons ?? []);
    } catch {
      // The plan card degrades to empty; the categories above still work.
    }
  }, [planMonth]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      void load();
      void loadPlan();
    }, 0);
    return () => window.clearTimeout(kickoff);
  }, [load, loadPlan]);

  async function savePlan(categoryId: string) {
    const draft = (planDrafts[categoryId] ?? "").trim();
    let plannedCents: number | null = null;
    if (draft !== "") {
      const parsed = parseMoneyToCents(draft);
      if (!parsed.ok || parsed.cents < 0) {
        setMessage("That planned figure could not be read. Try 250.00, or blank to clear.");
        return;
      }
      plannedCents = parsed.cents;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/budget/plans", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, month: planMonth, plannedCents }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setMessage(failure?.error?.message ?? "The plan could not be saved.");
        return;
      }
      setPlanDrafts((drafts) => ({ ...drafts, [categoryId]: "" }));
      await loadPlan();
    } catch {
      setMessage("The plan could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(category: CategoryView) {
    setEditing(category.id);
    setMessage("");
    setDraft({
      name: category.name,
      tone: category.tone,
      limit: category.monthlyLimitCents === null ? "" : (category.monthlyLimitCents / 100).toFixed(2),
    });
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/budget/categories/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setMessage(failure?.error?.message ?? "The change could not be saved.");
        return false;
      }
      await load();
      return true;
    } catch {
      setMessage("The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    let monthlyLimitCents: number | null = null;
    if (draft.limit.trim() !== "") {
      const parsed = parseMoneyToCents(draft.limit);
      if (!parsed.ok || parsed.cents < 0) {
        setMessage("That monthly ceiling could not be read. Try a figure like 250.00.");
        return;
      }
      monthlyLimitCents = parsed.cents;
    }
    const saved = await patch(id, { name: draft.name.trim(), tone: draft.tone, monthlyLimitCents });
    if (saved) setEditing(null);
  }

  async function submitNew(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    let monthlyLimitCents: number | null = null;
    if (newLimit.trim() !== "") {
      const parsed = parseMoneyToCents(newLimit);
      if (!parsed.ok || parsed.cents < 0) {
        setMessage("That monthly ceiling could not be read. Try a figure like 250.00.");
        return;
      }
      monthlyLimitCents = parsed.cents;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/budget/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), kind: newKind, tone: newTone, monthlyLimitCents }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setMessage(failure?.error?.message ?? "The category could not be recorded.");
        return;
      }
      setNewName("");
      setNewLimit("");
      await load();
    } catch {
      setMessage("The category could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const active = categories.filter((category) => !category.isArchived);
  const archived = categories.filter((category) => category.isArchived);

  return (
    <div className="space-y-6" data-testid="budget-categories-panel">
      <Card>
        <SectionTitle title="Your categories" />
        {message ? (
          <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
            {message}
          </p>
        ) : null}
        {state === "loading" ? (
          <p className="mt-3 text-sm text-muted">Loading your categories…</p>
        ) : null}
        {state === "ready" && active.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Add your first one below — imports and the ledger classify against these."
          />
        ) : null}
        {active.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {active.map((category) => (
              <li key={category.id} className="flex flex-wrap items-center gap-3 py-3">
                {editing === category.id ? (
                  <>
                    <input
                      aria-label="Category name"
                      className="w-40 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                    <select
                      aria-label="Tone"
                      className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                      value={draft.tone}
                      onChange={(event) => setDraft({ ...draft, tone: event.target.value })}
                    >
                      {TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {tone}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Edit monthly ceiling"
                      className="w-28 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                      placeholder="No ceiling"
                      value={draft.limit}
                      onChange={(event) => setDraft({ ...draft, limit: event.target.value })}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50"
                      onClick={() => void saveEdit(category.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-sm text-muted underline"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-32 text-sm font-medium">{category.name}</span>
                    <span className="text-xs uppercase tracking-wide text-muted">{category.kind}</span>
                    <span className="text-xs text-muted">{category.tone}</span>
                    <span className="text-sm text-muted">
                      {category.monthlyLimitCents === null
                        ? "No monthly ceiling"
                        : `${formatCents(category.monthlyLimitCents)} / month`}
                    </span>
                    <span className="ml-auto flex gap-3">
                      <button
                        type="button"
                        className="text-sm underline"
                        onClick={() => beginEdit(category)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-sm text-muted underline disabled:opacity-50"
                        onClick={() => void patch(category.id, { isArchived: true })}
                      >
                        Archive
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="Add a category" />
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={submitNew}>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Name</span>
            <input
              required
              className="w-44 rounded border border-[var(--border)] bg-transparent px-2 py-1"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Kind</span>
            <select
              className="rounded border border-[var(--border)] bg-transparent px-2 py-1"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as (typeof KINDS)[number])}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Tone</span>
            <select
              className="rounded border border-[var(--border)] bg-transparent px-2 py-1"
              value={newTone}
              onChange={(event) => setNewTone(event.target.value as (typeof TONES)[number])}
            >
              {TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Monthly ceiling</span>
            <input
              className="w-28 rounded border border-[var(--border)] bg-transparent px-2 py-1"
              placeholder="Optional"
              value={newLimit}
              onChange={(event) => setNewLimit(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Add category
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Kind cannot be changed later — history is classified under it. Archive a category instead
          of deleting it; past rows keep their classification either way.
        </p>
      </Card>

      <Card>
        <SectionTitle
          title="This month's plan"
          description="Planned against actual, using the same spend definition as the overview: money out, transfers excluded."
        />
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-xs text-muted">Month</span>
          <input
            type="month"
            className="rounded border border-[var(--border)] bg-transparent px-2 py-1"
            value={planMonth.slice(0, 7)}
            onChange={(event) => {
              if (event.target.value) setPlanMonth(`${event.target.value}-01`);
            }}
          />
        </label>
        {active.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Add a category above to plan against it.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="budget-month-plan">
            {active.map((category) => {
              const comparison = comparisons.find((entry) => entry.categoryId === category.id);
              return (
                <li key={category.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-32 font-medium">{category.name}</span>
                  {comparison ? (
                    <span className={comparison.overspent ? "text-[var(--danger)]" : "text-muted"}>
                      {formatCents(comparison.spentCents)} of {formatCents(comparison.plannedCents)}
                      {comparison.overspent
                        ? ` — over by ${formatCents(Math.abs(comparison.remainingCents))}`
                        : ` — ${formatCents(comparison.remainingCents)} left`}
                    </span>
                  ) : (
                    <span className="text-muted">No plan for this month.</span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <input
                      aria-label={`Planned for ${category.name}`}
                      className="w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1"
                      placeholder={comparison ? (comparison.plannedCents / 100).toFixed(2) : "Plan"}
                      value={planDrafts[category.id] ?? ""}
                      onChange={(event) =>
                        setPlanDrafts((drafts) => ({ ...drafts, [category.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm underline disabled:opacity-50"
                      onClick={() => void savePlan(category.id)}
                    >
                      {(planDrafts[category.id] ?? "").trim() === "" && comparison ? "Clear" : "Set"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {archived.length > 0 ? (
        <Card>
          <SectionTitle title="Archived" />
          <ul className="mt-3 space-y-2">
            {archived.map((category) => (
              <li key={category.id} className="flex items-center gap-3 text-sm text-muted">
                <span>{category.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  className="underline disabled:opacity-50"
                  onClick={() => void patch(category.id, { isArchived: false })}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
