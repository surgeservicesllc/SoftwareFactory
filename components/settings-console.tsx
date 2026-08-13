"use client";

import { Loader2, LockKeyhole, RefreshCw, Save, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { TenantStateGate } from "@/components/tenant-states";
import { Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { postJson, useTenantResource } from "@/lib/client/use-tenant-resource";

type SettingsPayload = {
  canManage: boolean;
  settings: {
    factory: { name: string; timezone: string };
    execution: {
      enabled: boolean;
      maxRepairAttempts: number;
      maxCiRepairAttempts: number;
      maxConcurrentRuns: number;
      defaultProvider: string;
      defaultModel: string;
    };
    reporting: { dailyReportEnabled: boolean; dailyReportHour: number };
    notifications: { onOwnerAction: boolean; onRunFailure: boolean; onSecurityFinding: boolean };
    data: { activityRetentionDays: number };
    updatedAt: string;
  };
  providers: {
    implemented: Array<{
      key: string;
      label: string;
      models: string[];
      status: { state: string; detail: string; ownerAction: string | null };
    }>;
  };
  autonomy: {
    autonomousMode: boolean;
    globalKillSwitchActive: boolean;
    maximumAutonomousRisk: string;
    autoApprove: boolean;
    autoMerge: boolean;
    autoDeploy: boolean;
    autoRollback: boolean;
    executorConnected: boolean;
    locked: boolean;
    lockedReason: string;
  };
  worker: { tickConfigured: boolean };
};

export function SettingsConsole() {
  const settings = useTenantResource<SettingsPayload>("/api/settings");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  if (settings.state !== "ready" || !settings.data) {
    return <TenantStateGate state={settings.state} message={settings.message} subject="settings" next="/settings" />;
  }

  const { canManage, settings: current, providers, autonomy, worker } = settings.data;
  const provider = providers.implemented.find((candidate) => candidate.key === current.execution.defaultProvider)
    ?? providers.implemented[0];

  function set(key: string, value: unknown) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function value<T>(key: string, fallback: T): T {
    return (draft[key] as T | undefined) ?? fallback;
  }

  async function save() {
    if (Object.keys(draft).length === 0) return;
    setSaving(true);
    const { ok, body } = await postJson("/api/settings", draft, "PATCH");
    setSaving(false);
    setMessage(ok ? "Settings saved." : (body.error?.message ?? "Settings could not be saved."));
    if (ok) {
      // Clear the draft so the form shows what was actually persisted rather
      // than what was typed.
      setDraft({});
      settings.reload();
    }
  }

  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge tone={autonomy.globalKillSwitchActive ? "danger" : "warning"}>
          Kill switch {autonomy.globalKillSwitchActive ? "ON" : "OFF"}
        </StatusBadge>
        <div className="flex gap-2">
          <button type="button" onClick={settings.reload} disabled={settings.refreshing} className="secondary-action">
            {settings.refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
          {canManage ? (
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="primary-action">
              {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              Save changes
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p role="status" className="rounded-lg border border-[#2a3542] bg-[#0b1017] p-3 text-[10px] leading-5 text-[#9aa7b7]">
          {message}
        </p>
      ) : null}

      {!canManage ? (
        <p className="rounded-lg border border-[#423824] bg-[#221c11] p-3 text-[10px] leading-5 text-[#b6a77f]">
          These settings are read-only for your role. Only an organization owner may change them.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Panel className="p-5 sm:p-6">
            <SectionTitle title="Factory" description="How this control plane identifies itself." />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Factory name">
                <input
                  className="form-control"
                  disabled={!canManage}
                  maxLength={120}
                  onChange={(event) => set("factoryName", event.target.value)}
                  value={value("factoryName", current.factory.name)}
                />
              </Field>
              <Field label="Timezone">
                <input
                  className="form-control"
                  disabled={!canManage}
                  maxLength={64}
                  onChange={(event) => set("timezone", event.target.value)}
                  value={value("timezone", current.factory.timezone)}
                />
              </Field>
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionTitle
              title="Execution"
              description="Commanded execution is separate from autonomy: it lets an owner-submitted command reach a worker, and always ends at a draft pull request."
            />
            <div className="mt-4 space-y-3">
              <Toggle
                label="Commanded execution"
                description={
                  worker.tickConfigured
                    ? "When ON, queued runs are claimed by the durable worker."
                    : "No worker tick credential is configured, so queued runs will not be picked up even when this is ON."
                }
                checked={value("executionEnabled", current.execution.enabled)}
                disabled={!canManage}
                onChange={(next) => set("executionEnabled", next)}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Worker repair attempts">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    className="form-control"
                    disabled={!canManage}
                    onChange={(event) => set("maxRepairAttempts", Number(event.target.value))}
                    value={value("maxRepairAttempts", current.execution.maxRepairAttempts)}
                  />
                </Field>
                <Field label="CI repair attempts">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    className="form-control"
                    disabled={!canManage}
                    onChange={(event) => set("maxCiRepairAttempts", Number(event.target.value))}
                    value={value("maxCiRepairAttempts", current.execution.maxCiRepairAttempts)}
                  />
                </Field>
                <Field label="Concurrent runs">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="form-control"
                    disabled={!canManage}
                    onChange={(event) => set("maxConcurrentRuns", Number(event.target.value))}
                    value={value("maxConcurrentRuns", current.execution.maxConcurrentRuns)}
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Default provider">
                  <select
                    className="form-control"
                    disabled={!canManage}
                    onChange={(event) => set("defaultProvider", event.target.value)}
                    value={value("defaultProvider", current.execution.defaultProvider)}
                  >
                    {providers.implemented.map((candidate) => (
                      <option key={candidate.key} value={candidate.key}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default model">
                  <select
                    className="form-control"
                    disabled={!canManage}
                    onChange={(event) => set("defaultModel", event.target.value)}
                    value={value("defaultModel", current.execution.defaultModel)}
                  >
                    {(provider?.models ?? []).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {provider?.status.ownerAction ? (
                <p className="rounded-lg border border-[#423824] bg-[#221c11] p-3 text-[10px] leading-5 text-[#b6a77f]">
                  Owner action: {provider.status.ownerAction}
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionTitle title="Reporting and notifications" description="Internal preferences only." />
            <div className="mt-4 space-y-3">
              <Toggle
                label="Daily CEO report"
                description="Compute and publish the daily brief on a schedule."
                checked={value("dailyReportEnabled", current.reporting.dailyReportEnabled)}
                disabled={!canManage}
                onChange={(next) => set("dailyReportEnabled", next)}
              />
              <Toggle
                label="Notify on owner action required"
                description="Surface commands and tasks that are waiting on a decision."
                checked={value("notifyOnOwnerAction", current.notifications.onOwnerAction)}
                disabled={!canManage}
                onChange={(next) => set("notifyOnOwnerAction", next)}
              />
              <Toggle
                label="Notify on run failure"
                checked={value("notifyOnRunFailure", current.notifications.onRunFailure)}
                disabled={!canManage}
                onChange={(next) => set("notifyOnRunFailure", next)}
              />
              <Toggle
                label="Notify on security finding"
                checked={value("notifyOnSecurityFinding", current.notifications.onSecurityFinding)}
                disabled={!canManage}
                onChange={(next) => set("notifyOnSecurityFinding", next)}
              />
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionTitle title="Data" description="Retention for tenant audit evidence." />
            <div className="mt-4 max-w-xs">
              <Field label="Activity retention (days)">
                <input
                  type="number"
                  min={30}
                  max={3650}
                  className="form-control"
                  disabled={!canManage}
                  onChange={(event) => set("activityRetentionDays", Number(event.target.value))}
                  value={value("activityRetentionDays", current.data.activityRetentionDays)}
                />
              </Field>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="border-[#4a292e] bg-[#170f11] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#e4b1b5]">Autonomous mode</p>
              <StatusBadge tone="danger">OFF</StatusBadge>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-[#9a7479]">{autonomy.lockedReason}</p>
            <dl className="mt-4 space-y-2">
              {(
                [
                  ["Global kill switch", autonomy.globalKillSwitchActive ? "ON" : "OFF"],
                  ["Maximum autonomous risk", autonomy.maximumAutonomousRisk],
                  ["Auto approve", autonomy.autoApprove ? "ON" : "OFF"],
                  ["Auto merge", autonomy.autoMerge ? "ON" : "OFF"],
                  ["Auto deploy", autonomy.autoDeploy ? "ON" : "OFF"],
                  ["Auto rollback", autonomy.autoRollback ? "ON" : "OFF"],
                  ["Autonomous executor", autonomy.executorConnected ? "Connected" : "Not Connected"],
                ] as const
              ).map(([label, state]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-[10px]">
                  <dt className="text-[#9a7479]">{label}</dt>
                  <dd className="font-mono font-semibold text-[#e4b1b5]">{state}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex items-start gap-2 rounded border border-[#5a3035] bg-[#1e1113] p-2.5 text-[10px] leading-4 text-[#c99097]">
              <LockKeyhole className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              These are enforced by hosted database constraints. No control on this page can change them.
            </p>
          </Panel>

          <Panel className="p-5">
            <SectionTitle title="Risk model" description="The highest matching criterion wins." />
            <div className="mt-4 space-y-2">
              {(
                [
                  ["GREEN", "Low risk", "Reversible, narrow, no protected resources", "safe"],
                  ["YELLOW", "Meaningful", "Testable with enhanced validation", "warning"],
                  ["RED", "High impact", "Owner approval mandatory", "danger"],
                ] as const
              ).map(([tier, title, detail, tone]) => (
                <div key={tier} className="rounded-lg border border-[#293442] bg-[#0a0f16] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-[#d5dbe2]">{title}</p>
                    <StatusBadge tone={tone}>{tier}</StatusBadge>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-[#6a7787]">{detail}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle title="Security" description="Boundaries this build enforces." />
            <ul className="mt-4 space-y-2 text-[10px] leading-4 text-[#7f8b9a]">
              <li className="flex gap-2">
                <ShieldAlert className="mt-0.5 size-3 shrink-0 text-[#8b9d2e]" aria-hidden="true" />
                Provider credentials live only in server-side environment settings.
              </li>
              <li className="flex gap-2">
                <ShieldAlert className="mt-0.5 size-3 shrink-0 text-[#8b9d2e]" aria-hidden="true" />
                The worker boundary is service-role-only and revoked from browser sessions.
              </li>
              <li className="flex gap-2">
                <ShieldAlert className="mt-0.5 size-3 shrink-0 text-[#8b9d2e]" aria-hidden="true" />
                Proposed changes are secret-scanned and protected-path checked before any commit.
              </li>
              <li className="flex gap-2">
                <ShieldAlert className="mt-0.5 size-3 shrink-0 text-[#8b9d2e]" aria-hidden="true" />
                There is no default-branch write path and no merge or deploy executor.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-[#293442] bg-[#0a0f16] p-3.5">
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[#d5dbe2]">{label}</span>
        {description ? <span className="mt-1 block text-[10px] leading-4 text-[#6a7787]">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "border-[#4c6520] bg-[#2c3d14]" : "border-[#333f4e] bg-[#161d27]"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full transition-all ${
            checked ? "left-[22px] bg-[#c6f135]" : "left-0.5 bg-[#5f6c7c]"
          }`}
        />
      </button>
    </div>
  );
}
