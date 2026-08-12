"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SoftwareFactory route error", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="card max-w-md p-8 text-center">
        <TriangleAlert className="mx-auto size-8 text-[var(--danger)]" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">This page could not load</h1>
        <p className="mt-2 text-muted">
          Nothing was changed. Try again — if it keeps happening, the server logs will say why.
        </p>
        <button type="button" onClick={reset} className="btn btn-primary mt-6">
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    </div>
  );
}
