"use client";

import { GitFork, Globe2, Plus, ServerCog } from "lucide-react";
import { useState } from "react";

import { SafetyControls } from "@/components/safety-controls";
import { NotConnectedBadge } from "@/components/ui";

export function ProjectForm() {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0b1003] transition-colors hover:bg-[#d8ff52]"
      >
        <Plus className="size-4" aria-hidden="true" />
        Define project
      </button>
    );
  }

  return (
    <div className="panel rounded-xl p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">New project definition</p>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em] text-white">Describe a managed software system</h2>
          <p className="mt-1 text-xs leading-5 text-[#738091]">This form exposes the Phase 1A project model. Persistence requires authenticated Supabase setup.</p>
        </div>
        <NotConnectedBadge label="Supabase Not Connected" />
      </div>

      <form className="mt-6" onSubmit={(event) => event.preventDefault()}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Project name" name="name" placeholder="e.g. Customer portal" required />
          <SelectField label="Status" name="status" options={["Draft", "Active", "Paused", "Archived"]} />
          <div className="md:col-span-2">
            <TextAreaField label="Description" name="description" placeholder="What this project does, who it serves, and its current operating context." />
          </div>
          <TextField label="GitHub repository" name="repository" placeholder="organization/repository" icon={GitFork} />
          <TextField label="Default branch" name="defaultBranch" placeholder="main" />
          <TextField label="Production URL" name="productionUrl" placeholder="https://example.com" icon={Globe2} type="url" />
          <div className="rounded-lg border border-[#283341] bg-[#0b1017] px-3.5 py-3">
            <p className="text-[11px] font-semibold text-[#c9d0d8]">Health status</p>
            <p className="mt-1 text-[10px] leading-4 text-[#687586]">Unknown until a verified provider and post-deploy checks are connected.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["GitHub", GitFork],
            ["Vercel", ServerCog],
            ["Supabase", ServerCog],
          ].map(([provider, Icon]) => (
            <div key={provider as string} className="rounded-lg border border-[#283341] bg-[#0b1017] p-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#cbd2da]">
                <Icon className="size-4 text-[#738091]" aria-hidden="true" />
                {provider as string}
              </div>
              <div className="mt-3"><NotConnectedBadge /></div>
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-[#202a36] pt-6">
          <SafetyControls />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setExpanded(false)} className="min-h-10 rounded-lg border border-[#2b3644] px-4 text-xs font-semibold text-[#8995a4] hover:bg-[#141b24]">Cancel</button>
          <button type="submit" disabled className="min-h-10 cursor-not-allowed rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0b1003] opacity-40" title="Connect Supabase and authenticate to save projects">
            Save project — Not Connected
          </button>
        </div>
      </form>
    </div>
  );
}

function TextField({
  label,
  name,
  placeholder,
  type = "text",
  required,
  icon: Icon,
}: {
  label: string;
  name: string;
  placeholder: string;
  type?: string;
  required?: boolean;
  icon?: typeof GitFork;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">{label}</span>
      <span className="relative block">
        {Icon ? <Icon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5d6978]" aria-hidden="true" /> : null}
        <input
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          className={`h-10 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-xs text-[#dce2e8] placeholder:text-[#4f5b69] focus:border-[#647f29] focus:outline-none ${Icon ? "pl-9" : ""}`}
        />
      </span>
    </label>
  );
}

function TextAreaField({ label, name, placeholder }: { label: string; name: string; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">{label}</span>
      <textarea name={name} rows={3} placeholder={placeholder} className="w-full resize-y rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 py-2.5 text-xs leading-5 text-[#dce2e8] placeholder:text-[#4f5b69] focus:border-[#647f29] focus:outline-none" />
    </label>
  );
}

function SelectField({ label, name, options }: { label: string; name: string; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold text-[#aeb7c2]">{label}</span>
      <select name={name} className="h-10 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-xs text-[#dce2e8] focus:border-[#647f29] focus:outline-none">
        {options.map((option) => <option key={option} value={option.toLowerCase()}>{option}</option>)}
      </select>
    </label>
  );
}
