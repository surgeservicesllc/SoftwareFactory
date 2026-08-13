import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-faint">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-foreground">
          This page does not exist
        </h1>
        <p className="mt-2 text-muted">Check the address, or head back to the dashboard.</p>
        <Link href="/" className="btn btn-primary mt-6">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
