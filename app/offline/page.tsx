import { WifiOff } from "lucide-react";

/**
 * Shown only when a navigation fails and the device is offline.
 *
 * Deliberately empty of data. This page is the one thing the service worker
 * caches, so anything on it would be readable by whoever holds the device,
 * signed in or not, until the cache is cleared. It says what happened and
 * nothing about the workspace.
 */
export const metadata = {
  title: "Offline",
  description: "SoftwareFactory could not reach the network.",
};

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-line bg-surface text-muted">
          <WifiOff className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-foreground">You are offline</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          SoftwareFactory needs a connection to show live workspace state. Nothing has been lost —
          reconnect and this page will load normally.
        </p>
      </div>
    </main>
  );
}
