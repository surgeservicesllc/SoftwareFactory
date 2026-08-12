"use client";

import {
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  FileText,
  Folder,
  History,
  Loader2,
  Save,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/cn";
import type { RepositoryMemoryFile } from "@/lib/repository-memory";

const categoryOrder = ["AI", "Agents", "Policies", "Prompts", "Checklists", "Playbooks", "Documentation"];

type SaveState = "idle" | "saving" | "saved" | "error";

export function FileManager({ files }: { files: RepositoryMemoryFile[] }) {
  const firstAvailable = files.find((file) => file.available) ?? files[0];
  const [selectedPath, setSelectedPath] = useState(firstAvailable?.path ?? "AGENTS.md");
  const [contents, setContents] = useState<Record<string, string>>(
    Object.fromEntries(files.map((file) => [file.path, file.content])),
  );
  const [savedContents, setSavedContents] = useState<Record<string, string>>(
    Object.fromEntries(files.map((file) => [file.path, file.content])),
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  const selected = files.find((file) => file.path === selectedPath) ?? firstAvailable;
  const currentContent = contents[selectedPath] ?? "";
  const isDirty = currentContent !== (savedContents[selectedPath] ?? "");

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return categoryOrder.map((category) => ({
      category,
      files: files.filter(
        (file) =>
          file.category === category &&
          (!normalized ||
            file.label.toLowerCase().includes(normalized) ||
            file.path.toLowerCase().includes(normalized) ||
            file.content.toLowerCase().includes(normalized)),
      ),
    }));
  }, [files, query]);

  useEffect(() => {
    function preventUnload(event: BeforeUnloadEvent) {
      const hasUnsavedChanges = Object.keys(contents).some(
        (filePath) => contents[filePath] !== savedContents[filePath],
      );
      if (hasUnsavedChanges) event.preventDefault();
    }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [contents, savedContents]);

  useEffect(() => {
    function protectInternalNavigation(event: MouseEvent) {
      const hasUnsavedChanges = Object.keys(contents).some(
        (filePath) => contents[filePath] !== savedContents[filePath],
      );
      if (!hasUnsavedChanges || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("Leave this page and discard unsaved repository changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("click", protectInternalNavigation, true);
    return () => document.removeEventListener("click", protectInternalNavigation, true);
  }, [contents, savedContents]);

  useEffect(() => {
    function keyboardSave(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        document.getElementById("save-repository-file")?.click();
      }
    }
    window.addEventListener("keydown", keyboardSave);
    return () => window.removeEventListener("keydown", keyboardSave);
  }, []);

  function chooseFile(nextPath: string) {
    if (nextPath === selectedPath) return;
    if (isDirty && !window.confirm("Discard unsaved changes to the open file?")) return;
    setSelectedPath(nextPath as RepositoryMemoryFile["path"]);
    setSaveState("idle");
    setMessage("");
  }

  async function saveFile() {
    if (!selected || !isDirty) return;
    setSaveState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected.path, content: currentContent }),
      });
      const body = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error ?? "The file could not be saved.");
      setSavedContents((current) => ({ ...current, [selected.path]: currentContent }));
      setSaveState("saved");
      setMessage(body.message ?? "Saved.");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "The file could not be saved.");
    }
  }

  return (
    <div className="panel min-h-[680px] overflow-hidden rounded-xl lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-[#202b38] bg-[#0a0f16] lg:border-b-0 lg:border-r" aria-label="Repository files">
        <div className="border-b border-[#202b38] p-3.5">
          <label className="relative block">
            <span className="sr-only">Search repository memory</span>
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#5e6a79]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search memory…"
              className="h-9 w-full rounded-lg border border-[#293442] bg-[#10161e] pl-9 pr-3 text-[11px] text-[#d8dee5] placeholder:text-[#54606e] focus:border-[#607a28] focus:outline-none"
            />
          </label>
        </div>
        <div className="max-h-[310px] overflow-y-auto p-2 lg:max-h-[620px]">
          {filteredGroups.map((group) => (
            <div key={group.category} className="mb-1">
              <div className="flex min-h-8 items-center gap-2 px-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#647182]">
                <ChevronRight className="size-3" aria-hidden="true" />
                <Folder className="size-3.5 text-[#7a8736]" aria-hidden="true" />
                {group.category}
                <span className="ml-auto text-[#46515f]">{group.files.length}</span>
              </div>
              {group.files.length ? (
                <div className="space-y-0.5">
                  {group.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => chooseFile(file.path)}
                      disabled={!file.available}
                      className={cn(
                        "flex min-h-8 w-full items-center gap-2 rounded-md px-3 pl-7 text-left text-[10px] transition-colors",
                        selectedPath === file.path
                          ? "bg-[#c6f135]/[0.08] text-[#dffb7b]"
                          : file.available
                            ? "text-[#7f8c9c] hover:bg-[#131b25] hover:text-[#c3cbd4]"
                            : "cursor-not-allowed text-[#414b57]",
                      )}
                      title={file.available ? file.path : `${file.path} is not present yet`}
                    >
                      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{file.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-7 py-1 text-[9px] text-[#424c59]">No files</p>
              )}
            </div>
          ))}
        </div>
      </aside>

      <section className="min-w-0">
        <header className="flex flex-col gap-3 border-b border-[#202b38] bg-[#0d131c] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileCode2 className="size-4 shrink-0 text-[#849427]" aria-hidden="true" />
              <h2 className="truncate font-mono text-[11px] font-semibold text-[#d8dee5]">{selected?.path ?? "No file selected"}</h2>
              {isDirty ? <span className="size-1.5 shrink-0 rounded-full bg-[#ffbe55]" title="Unsaved changes" /> : null}
            </div>
            <p className="mt-1 truncate text-[9px] text-[#53606f]">SoftwareFactory repository · Markdown</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-[#293442] bg-[#0a0f16] p-0.5">
              {(["edit", "preview"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMode(tab)}
                  aria-pressed={mode === tab}
                  className={cn(
                    "min-h-7 rounded px-2.5 text-[9px] font-semibold capitalize",
                    mode === tab ? "bg-[#1d2632] text-[#d8dee5]" : "text-[#687586]",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              id="save-repository-file"
              type="button"
              onClick={saveFile}
              disabled={!isDirty || saveState === "saving"}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#3c4b20] bg-[#c6f135]/[0.08] px-2.5 text-[9px] font-semibold text-[#dffb7b] disabled:cursor-not-allowed disabled:border-[#29323d] disabled:bg-[#121820] disabled:text-[#56616e]"
            >
              {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : saveState === "saved" && !isDirty ? <Check className="size-3.5" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {selected?.available ? (
          <div>
            {mode === "edit" ? (
              <label className="block">
                <span className="sr-only">Edit {selected.label}</span>
                <textarea
                  value={currentContent}
                  onChange={(event) => {
                    setContents((current) => ({ ...current, [selectedPath]: event.target.value }));
                    setSaveState("idle");
                    setMessage("");
                  }}
                  spellCheck
                  className="min-h-[530px] w-full resize-y border-0 bg-[#090e14] p-4 font-mono text-[12px] leading-6 text-[#b7c2cd] focus:outline-none sm:p-6"
                />
              </label>
            ) : (
              <article className="prose-dark min-h-[530px] overflow-auto bg-[#0b1017] p-5 sm:p-8">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
              </article>
            )}

            <footer className="flex min-h-10 flex-col gap-2 border-t border-[#202b38] bg-[#0d131c] px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <p aria-live="polite" className={cn("flex items-center gap-1.5 text-[9px]", saveState === "error" ? "text-[#e59399]" : "text-[#627080]") }>
                {saveState === "error" ? <ShieldAlert className="size-3" aria-hidden="true" /> : <Clock3 className="size-3" aria-hidden="true" />}
                {message || (isDirty ? "Unsaved changes protected on window close" : "No unsaved changes")}
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-[#4e5967]">
                <History className="size-3" aria-hidden="true" />
                History · Placeholder · Not Connected
              </p>
            </footer>
          </div>
        ) : (
          <div className="grid min-h-[570px] place-items-center p-8 text-center">
            <div>
              <FileText className="mx-auto size-8 text-[#4d5967]" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold text-[#aeb7c1]">This memory file has not been created yet</p>
              <p className="mt-2 text-[10px] text-[#637080]">The category remains visible so the architecture can grow without changing the file model.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
