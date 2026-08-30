"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import type { SearchPayload } from "@/components/services/types";

/**
 * Global search over the book of business — accounts, contacts, properties
 * and opportunities in one box, present on every Services page through the
 * shell. Every hit is a real row read under RLS, and every hit lands on the
 * account it belongs to, because the account page is where the 360-degree
 * record lives.
 */

const DEBOUNCE_MS = 250;

export function ServicesSearch({ onNavigate }: { onNavigate?: () => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const needle = term.trim();
    // Below two characters there is nothing to ask; the change handler
    // already cleared the results.
    if (needle.length < 2) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/services/search?q=${encodeURIComponent(needle)}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          setResults(null);
          setFailed(true);
          return;
        }
        setFailed(false);
        setResults((await response.json()) as SearchPayload);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults(null);
          setFailed(true);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const clear = () => {
    setTerm("");
    setResults(null);
    onNavigate?.();
  };

  const empty =
    results !== null &&
    results.accounts.length === 0 &&
    results.contacts.length === 0 &&
    results.properties.length === 0 &&
    results.opportunities.length === 0;

  return (
    <div className="mb-4" data-testid="services-search">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <span className="sr-only">Search accounts, contacts, properties and opportunities</span>
        <input
          type="search"
          value={term}
          onChange={(event) => {
            const next = event.target.value;
            setTerm(next);
            if (next.trim().length < 2) {
              setResults(null);
              setFailed(false);
            }
          }}
          placeholder="Search everything…"
          maxLength={120}
          className="input w-full py-1.5 pl-8 text-sm"
        />
      </label>
      {failed ? <p className="mt-2 px-1 text-xs text-faint">Search is unavailable.</p> : null}
      {empty ? (
        <p className="mt-2 px-1 text-xs text-faint">Nothing matches “{results?.query}”.</p>
      ) : null}
      {results !== null && !empty ? (
        <div className="mt-2 space-y-2" data-testid="services-search-results">
          <SearchGroup label="Accounts" onNavigate={clear}>
            {results.accounts.map((hit) => ({
              key: hit.id,
              accountId: hit.id,
              primary: hit.name,
              secondary: `${hit.kind} · ${hit.status}`,
            }))}
          </SearchGroup>
          <SearchGroup label="Contacts" onNavigate={clear}>
            {results.contacts.map((hit) => ({
              key: hit.id,
              accountId: hit.accountId,
              primary: [hit.firstName, hit.lastName].filter(Boolean).join(" "),
              secondary: hit.email ?? hit.role ?? "contact",
            }))}
          </SearchGroup>
          <SearchGroup label="Properties" onNavigate={clear}>
            {results.properties.map((hit) => ({
              key: hit.id,
              accountId: hit.accountId,
              primary: hit.label,
              secondary: hit.address,
            }))}
          </SearchGroup>
          <SearchGroup label="Opportunities" onNavigate={clear}>
            {results.opportunities.map((hit) => ({
              key: hit.id,
              accountId: hit.accountId,
              primary: hit.name,
              secondary: `stage: ${hit.stage}`,
            }))}
          </SearchGroup>
        </div>
      ) : null}
    </div>
  );
}

type SearchHit = { key: string; accountId: string; primary: string; secondary: string };

function SearchGroup({
  label,
  children,
  onNavigate,
}: {
  label: string;
  children: SearchHit[];
  onNavigate: () => void;
}) {
  if (children.length === 0) return null;
  return (
    <div>
      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {children.map((hit) => (
          <li key={hit.key}>
            <Link
              href={`/Services/customers/${hit.accountId}`}
              onClick={onNavigate}
              className="block rounded px-1.5 py-1 text-sm hover:bg-surface-raised"
            >
              <span className="block truncate text-foreground">{hit.primary}</span>
              <span className="block truncate text-xs text-faint">{hit.secondary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
