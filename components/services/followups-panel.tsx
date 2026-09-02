"use client";

import { AlertTriangle, CalendarCheck, CheckCircle2, ListTodo, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, MetricCard, PageHeader, SectionTitle } from "@/components/ui";
import {
  SUGGESTION_RULES,
  taskBucket,
  type CrmTaskPriority,
  type SuggestionView,
  type TaskView,
} from "@/lib/services/followups";

/**
 * Follow-ups: what is owed today, and what the book suggests next.
 *
 * The suggestions are computed from the workspace's own rows at the moment
 * the page loads, each with the fact that raised it printed beside it. A
 * suggestion is not a task until somebody accepts it, and accepting keeps
 * the reason — so a follow-up read back next month still says why it
 * existed.
 */

type Employee = { id: string; name: string; role: string };
type Board = {
  today: string;
  tasks: TaskView[];
  recent: TaskView[];
  suggestions: SuggestionView[];
  employees: Employee[];
  counts: { open: number; overdue: number; dueToday: number; doneThisWeek: number; suggestions: number };
};

const PRIORITY_LABEL: Record<CrmTaskPriority, string> = { low: "Low", normal: "Normal", high: "High" };

async function readFailure(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function ServicesFollowupsPanel() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [priority, setPriority] = useState<CrmTaskPriority>("normal");
  const [assignee, setAssignee] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/services/followups", { cache: "no-store" });
      if (!response.ok) {
        setLoadError(await readFailure(response, "Follow-ups could not be read."));
        return;
      }
      setBoard((await response.json()) as Board);
    } catch {
      setLoadError("Follow-ups could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  async function send(input: RequestInfo, init: RequestInit, failure: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(input, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });
      if (!response.ok) {
        setMessage(await readFailure(response, failure));
        return;
      }
      await load();
    } catch {
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  }

  function createTask(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim().length === 0 || !dueOn) return;
    void send(
      "/api/services/followups",
      {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          dueOn,
          priority,
          assigneeEmployeeId: assignee || null,
        }),
      },
      "The follow-up could not be recorded.",
    ).then(() => {
      setTitle("");
      setDueOn("");
      setPriority("normal");
    });
  }

  function patchTask(taskId: string, changes: Record<string, unknown>) {
    void send(
      "/api/services/followups",
      { method: "PATCH", body: JSON.stringify({ taskId, ...changes }) },
      "The follow-up could not be updated.",
    );
  }

  function accept(suggestionKey: string) {
    void send(
      "/api/services/followups/suggestions",
      { method: "POST", body: JSON.stringify({ suggestionKey, assigneeEmployeeId: assignee || null }) },
      "The suggestion could not be accepted.",
    );
  }

  function dismiss(suggestionKey: string) {
    void send(
      "/api/services/followups/suggestions",
      { method: "PUT", body: JSON.stringify({ suggestionKey, days: 30 }) },
      "The suggestion could not be dismissed.",
    );
  }

  const employeeName = (id: string | null) =>
    id === null ? "Unassigned" : (board?.employees.find((employee) => employee.id === id)?.name ?? "Unassigned");

  const today = board?.today ?? "";
  const buckets = { overdue: [] as TaskView[], today: [] as TaskView[], later: [] as TaskView[] };
  for (const task of board?.tasks ?? []) {
    const bucket = taskBucket(task, today);
    if (bucket) buckets[bucket].push(task);
  }

  return (
    <div className="space-y-6" data-testid="services-followups">
      <PageHeader
        title="Follow-ups"
        description="What is owed today, and what your own records suggest doing next — each suggestion with the fact that raised it."
      />

      {loadError ? (
        <p role="alert" className="text-sm text-[var(--danger)]">{loadError}</p>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-[var(--danger)]">{message}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Overdue"
          value={loading ? "—" : String(board?.counts.overdue ?? 0)}
          detail="Open follow-ups past their date"
          icon={AlertTriangle}
          tone={(board?.counts.overdue ?? 0) > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="Due today"
          value={loading ? "—" : String(board?.counts.dueToday ?? 0)}
          detail="Open follow-ups dated today"
          icon={CalendarCheck}
        />
        <MetricCard
          label="Suggested"
          value={loading ? "—" : String(board?.counts.suggestions ?? 0)}
          detail="Next steps computed from your records"
          icon={Sparkles}
          tone={(board?.counts.suggestions ?? 0) > 0 ? "info" : "neutral"}
        />
        <MetricCard
          label="Done this week"
          value={loading ? "—" : String(board?.counts.doneThisWeek ?? 0)}
          detail="Closed in the last seven days"
          icon={CheckCircle2}
          tone="safe"
        />
      </div>

      <Card>
        <SectionTitle
          title="Suggested next steps"
          description="Computed from your rows just now, never stored. Accept one to make it a follow-up; dismiss one and it stays quiet for thirty days."
        />
        {loading ? (
          <p className="mt-3 text-sm text-muted">Reading your records…</p>
        ) : (board?.suggestions.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing to suggest"
            description="None of the seven rules fires on your records right now: no stale leads, no overdue deals, no unanswered requests, no quiet overdue invoices, no expiring licences, no uncorrected high-severity sightings."
            icon={Sparkles}
          />
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="followup-suggestions">
            {board!.suggestions.map((suggestion) => (
              <li key={suggestion.suggestionKey} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{suggestion.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{suggestion.reason}</p>
                  <p className="mt-1 text-xs text-faint">
                    {SUGGESTION_RULES[suggestion.rule] ?? suggestion.rule} · {PRIORITY_LABEL[suggestion.priority]} priority · due {suggestion.dueOn}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                    onClick={() => accept(suggestion.suggestionKey)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border border-[var(--border)] px-3 py-1 text-xs text-muted disabled:opacity-50"
                    onClick={() => dismiss(suggestion.suggestionKey)}
                  >
                    Not now
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title="Add a follow-up" description="Your own, with a date and an owner." />
        <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" onSubmit={createTask}>
          <input
            aria-label="Follow-up"
            className="rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            placeholder="Call Harborview about the renewal"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            aria-label="Due on"
            type="date"
            className="rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
          <select
            aria-label="Priority"
            className="rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            value={priority}
            onChange={(event) => setPriority(event.target.value as CrmTaskPriority)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <select
            aria-label="Owner"
            className="rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Unassigned</option>
            {(board?.employees ?? []).map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || title.trim().length === 0 || !dueOn}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">
          The owner chosen here is also who an accepted suggestion goes to.
        </p>
      </Card>

      {(["overdue", "today", "later"] as const).map((bucket) => (
        <Card key={bucket}>
          <SectionTitle
            title={bucket === "overdue" ? "Overdue" : bucket === "today" ? "Due today" : "Coming up"}
            description={`${buckets[bucket].length} open`}
          />
          {loading ? null : buckets[bucket].length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing here.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]" data-testid={`followups-${bucket}`}>
              {buckets[bucket].map((task) => (
                <li key={task.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{task.title}</p>
                    {task.reason ? <p className="mt-0.5 text-sm text-muted">{task.reason}</p> : null}
                    <p className="mt-1 text-xs text-faint">
                      {employeeName(task.assigneeEmployeeId)} · {PRIORITY_LABEL[task.priority]} · due {task.dueOn}
                      {task.origin === "suggested" ? " · from a suggestion" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <select
                      aria-label={`Owner of ${task.title}`}
                      className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
                      value={task.assigneeEmployeeId ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        patchTask(task.id, { assigneeEmployeeId: event.target.value || null })}
                    >
                      <option value="">Unassigned</option>
                      {(board?.employees ?? []).map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                      onClick={() => patchTask(task.id, { status: "done" })}
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-[var(--border)] px-3 py-1 text-xs text-muted disabled:opacity-50"
                      onClick={() => patchTask(task.id, { status: "cancelled" })}
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}

      <Card>
        <SectionTitle title="Recently closed" description="Done or cancelled in the last seven days." />
        {loading ? null : (board?.recent.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing closed this week"
            description="Finished follow-ups appear here for seven days; one about an account also lands on that account's history."
            icon={ListTodo}
          />
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {board!.recent.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="text-sm">{task.title}</span>
                <span className="text-xs text-faint">
                  {task.status === "done" ? `done ${task.doneAt?.slice(0, 10) ?? ""}` : `cancelled ${task.cancelledAt?.slice(0, 10) ?? ""}`}
                  {task.status === "done" ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="ml-3 underline disabled:opacity-50"
                      onClick={() => patchTask(task.id, { status: "open" })}
                    >
                      Reopen
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
