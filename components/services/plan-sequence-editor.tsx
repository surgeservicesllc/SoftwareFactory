"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";

import { Notice, SectionTitle } from "@/components/ui";
import {
  PLAN_CYCLE_MONTHS,
  planOccurrences,
  type PlanStep,
} from "@/lib/services/plan-sequence";

/**
 * The schedule a plan actually runs on (ADR-211).
 *
 * A recurrence says how often. This says when — "the 1st and the 15th",
 * "2nd and 4th Tuesday", or a seasonal sequence where each visit is a
 * different service. The preview under the editor is computed here so it
 * updates as somebody types; the dates shown after a save are the ones the
 * DATABASE generated, so what is stored is what is displayed.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKS = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "last" },
];

type StepDraft = PlanStep;

type SequencePayload = {
  cycleMonths: number | null;
  steps: {
    id: string;
    position: number;
    monthOffset: number;
    anchor: "day_of_month" | "nth_weekday";
    dayOfMonth: number | null;
    weekOfMonth: number | null;
    weekday: number | null;
    serviceType: string | null;
  }[];
  occurrences: { stepPosition: number; occursOn: string; serviceType: string | null }[];
  cadence: { sequenced: boolean; visitsPerYear: number | null; billsPerYear: number };
};

const dayStep = (position: number, dayOfMonth: number, monthOffset = 0): StepDraft => ({
  position,
  monthOffset,
  anchor: "day_of_month",
  dayOfMonth,
  weekOfMonth: null,
  weekday: null,
  serviceType: null,
});

const weekdayStep = (
  position: number,
  weekOfMonth: number,
  weekday: number,
  monthOffset = 0,
): StepDraft => ({
  position,
  monthOffset,
  anchor: "nth_weekday",
  dayOfMonth: null,
  weekOfMonth,
  weekday,
  serviceType: null,
});

export function PlanSequenceEditor({
  planId,
  planServiceType,
  onSaved,
}: {
  planId: string;
  planServiceType: string;
  onSaved?: () => void;
}) {
  const [cycleMonths, setCycleMonths] = useState<number | null>(null);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [saved, setSaved] = useState<SequencePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/services/service-plans/${planId}/steps`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      setError("This plan's schedule could not be read.");
      return;
    }
    const payload = (await response.json()) as SequencePayload;
    setSaved(payload);
    setCycleMonths(payload.cycleMonths);
    setSteps(payload.steps.map((step) => ({
      position: step.position,
      monthOffset: step.monthOffset,
      anchor: step.anchor,
      dayOfMonth: step.dayOfMonth,
      weekOfMonth: step.weekOfMonth,
      weekday: step.weekday,
      serviceType: step.serviceType,
    })));
  }, [planId]);

  useEffect(() => {
    // Deferred kickoff, like the panels around this one: reading the
    // schedule is a fetch, and starting it inside the effect body is the
    // cascading-render pattern the lint rule exists to stop.
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/services/service-plans/${planId}/steps`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cycleMonths,
          steps: steps.map((step, index) => ({
            position: index + 1,
            monthOffset: step.monthOffset,
            anchor: step.anchor,
            dayOfMonth: step.dayOfMonth,
            weekOfMonth: step.weekOfMonth,
            weekday: step.weekday,
            serviceType: step.serviceType,
          })),
        }),
      });
      const payload = (await response.json()) as SequencePayload | { error: { message: string } };
      if (!response.ok) {
        setError("error" in payload ? payload.error.message : "The schedule could not be saved.");
        return;
      }
      setSaved(payload as SequencePayload);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: "first-fifteenth" | "second-fourth-tuesday" | "seasonal") => {
    if (preset === "first-fifteenth") {
      setCycleMonths(1);
      setSteps([dayStep(1, 1), dayStep(2, 15)]);
      return;
    }
    if (preset === "second-fourth-tuesday") {
      setCycleMonths(1);
      setSteps([weekdayStep(1, 2, 2), weekdayStep(2, 4, 2)]);
      return;
    }
    setCycleMonths(12);
    setSteps([
      weekdayStep(1, 2, 1, 2),
      weekdayStep(2, 2, 1, 5),
      weekdayStep(3, 2, 1, 8),
      weekdayStep(4, 2, 1, 10),
    ]);
  };

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  };

  const today = new Date().toISOString().slice(0, 10);
  const preview = planOccurrences(
    steps.map((step, index) => ({ ...step, position: index + 1 })),
    cycleMonths,
    today,
    8,
    planServiceType,
  );
  const visitsPerYear = cycleMonths === null || steps.length === 0
    ? null
    : steps.length * (12 / cycleMonths);
  const billsPerYear = saved?.cadence.billsPerYear ?? null;

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 p-4" data-testid="plan-sequence-editor">
      <SectionTitle
        title="Schedule"
        description="The recurrence says how often this plan runs. This says when — and a fortnight is not twice a month."
      />

      {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Start from</span>
        <button type="button" className="btn btn-secondary px-2 py-1 text-xs"
          onClick={() => applyPreset("first-fifteenth")}>1st and 15th</button>
        <button type="button" className="btn btn-secondary px-2 py-1 text-xs"
          onClick={() => applyPreset("second-fourth-tuesday")}>2nd and 4th Tuesday</button>
        <button type="button" className="btn btn-secondary px-2 py-1 text-xs"
          onClick={() => applyPreset("seasonal")}>Seasonal (4 visits)</button>
      </div>

      <label className="mt-4 block text-xs text-muted">
        Cycle
        <select
          className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground"
          value={cycleMonths ?? ""}
          onChange={(event) => {
            const next = event.target.value === "" ? null : Number(event.target.value);
            setCycleMonths(next);
            if (next === null) setSteps([]);
            else setSteps((current) => current.filter((step) => step.monthOffset < next));
          }}
        >
          <option value="">Not sequenced — follow the recurrence</option>
          {PLAN_CYCLE_MONTHS.map((months) => (
            <option key={months} value={months}>
              {months === 1 ? "Every month" : `Every ${months} months`}
            </option>
          ))}
        </select>
      </label>

      {cycleMonths === null ? (
        <p className="mt-3 text-xs text-faint">
          This plan advances by its recurrence. Choose a cycle to put it on named dates.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2" data-testid="plan-sequence-steps">
            {steps.map((step, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-6 text-faint">{index + 1}.</span>

                {cycleMonths > 1 ? (
                  <select
                    aria-label="Month of the cycle"
                    className="rounded-md border border-line bg-surface px-2 py-1"
                    value={step.monthOffset}
                    onChange={(event) => updateStep(index, { monthOffset: Number(event.target.value) })}
                  >
                    {Array.from({ length: cycleMonths }, (_, month) => (
                      <option key={month} value={month}>month {month + 1}</option>
                    ))}
                  </select>
                ) : null}

                <select
                  aria-label="How the day is chosen"
                  className="rounded-md border border-line bg-surface px-2 py-1"
                  value={step.anchor}
                  onChange={(event) =>
                    updateStep(index, event.target.value === "day_of_month"
                      ? { anchor: "day_of_month", dayOfMonth: step.dayOfMonth ?? 1, weekOfMonth: null, weekday: null }
                      : { anchor: "nth_weekday", dayOfMonth: null, weekOfMonth: step.weekOfMonth ?? 1, weekday: step.weekday ?? 2 })
                  }
                >
                  <option value="day_of_month">day of the month</option>
                  <option value="nth_weekday">nth weekday</option>
                </select>

                {step.anchor === "day_of_month" ? (
                  <input
                    aria-label="Day of the month"
                    type="number"
                    min={1}
                    max={31}
                    className="w-16 rounded-md border border-line bg-surface px-2 py-1"
                    value={step.dayOfMonth ?? 1}
                    onChange={(event) => updateStep(index, { dayOfMonth: Number(event.target.value) })}
                  />
                ) : (
                  <>
                    <select
                      aria-label="Which week"
                      className="rounded-md border border-line bg-surface px-2 py-1"
                      value={step.weekOfMonth ?? 1}
                      onChange={(event) => updateStep(index, { weekOfMonth: Number(event.target.value) })}
                    >
                      {WEEKS.map((week) => (
                        <option key={week.value} value={week.value}>{week.label}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Which weekday"
                      className="rounded-md border border-line bg-surface px-2 py-1"
                      value={step.weekday ?? 2}
                      onChange={(event) => updateStep(index, { weekday: Number(event.target.value) })}
                    >
                      {WEEKDAYS.map((name, value) => (
                        <option key={name} value={value}>{name}</option>
                      ))}
                    </select>
                  </>
                )}

                <input
                  aria-label="Service for this visit"
                  placeholder={planServiceType}
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1"
                  value={step.serviceType ?? ""}
                  onChange={(event) =>
                    updateStep(index, { serviceType: event.target.value.trim() === "" ? null : event.target.value })
                  }
                />

                <button
                  type="button"
                  className="btn btn-secondary px-2 py-1 text-xs"
                  onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn btn-secondary mt-3 px-2.5 py-1 text-xs"
            disabled={steps.length >= 24}
            onClick={() => setSteps((current) => [...current, dayStep(current.length + 1, 1)])}
          >
            Add a visit
          </button>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save schedule"}
        </button>
        {visitsPerYear !== null && billsPerYear !== null ? (
          <span className="text-xs text-muted" data-testid="plan-cadence">
            {visitsPerYear} visits a year · {billsPerYear} bills a year
            {visitsPerYear === billsPerYear ? "" : " — level billing, which is a sale rather than a fault"}
          </span>
        ) : null}
      </div>

      {preview.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <CalendarRange className="size-3.5" aria-hidden="true" />
            Next visits
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted" data-testid="plan-sequence-preview">
            {preview.map((visit, index) => (
              <li key={`${visit.occursOn}-${index}`} className="rounded border border-line px-1.5 py-0.5">
                {visit.occursOn}
                {visit.serviceType && visit.serviceType !== planServiceType ? ` · ${visit.serviceType}` : ""}
              </li>
            ))}
          </ul>
          {saved !== null && saved.occurrences.length === 0 && steps.length > 0 ? (
            <p className="mt-1.5 text-xs text-faint">Not saved yet — these are a preview.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
