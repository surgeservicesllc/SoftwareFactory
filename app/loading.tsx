export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading SoftwareFactory" className="animate-pulse">
      <div className="h-3 w-44 rounded bg-[#1c2632]" />
      <div className="mt-4 h-8 w-72 max-w-full rounded bg-[#1c2632]" />
      <div className="mt-3 h-4 w-[520px] max-w-full rounded bg-[#141c26]" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-36 rounded-xl border border-[#1d2733] bg-[#0d1219]" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
