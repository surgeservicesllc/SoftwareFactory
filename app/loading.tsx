export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="h-8 w-56 max-w-full rounded-lg bg-surface-raised" />
      <div className="mt-3 h-5 w-[420px] max-w-full rounded-lg bg-surface" />
      <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-40 rounded-xl border border-line bg-surface" />
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-32 rounded-xl border border-line bg-surface" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
