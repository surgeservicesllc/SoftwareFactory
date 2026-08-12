"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SoftwareFactory route error", error);
  }, [error]);

  return (
    <div className="grid min-h-[65vh] place-items-center">
      <div className="panel max-w-md rounded-xl p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl border border-[#4a292e] bg-[#2b171b] text-[#ff7d84]"><TriangleAlert className="size-5" aria-hidden="true" /></span>
        <h1 className="mt-4 text-lg font-semibold text-white">This control-plane view could not load</h1>
        <p className="mt-2 text-xs leading-5 text-[#788596]">No external action was taken. Retry the view, and consult the server logs if the problem persists.</p>
        <button type="button" onClick={reset} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0c1102]"><RefreshCw className="size-4" aria-hidden="true" />Try again</button>
      </div>
    </div>
  );
}
