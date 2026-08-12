import { ArrowLeft, Radar } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[65vh] place-items-center">
      <div className="text-center">
        <Radar className="mx-auto size-10 text-[#667526]" aria-hidden="true" />
        <p className="eyebrow mt-5">404 / Unmapped route</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">This control surface does not exist</h1>
        <p className="mt-2 text-xs text-[#748191]">Return to the command center and choose a mapped factory capability.</p>
        <Link href="/" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#c6f135] px-4 text-xs font-bold text-[#0c1102]"><ArrowLeft className="size-4" aria-hidden="true" />Back to dashboard</Link>
      </div>
    </div>
  );
}
