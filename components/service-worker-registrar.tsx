"use client";

import { useEffect } from "react";

/**
 * Registers the offline shell.
 *
 * Rendered once from the root layout and deliberately headless: installing a
 * service worker is not something to show a person a spinner about, and it must
 * never block or delay a page that is already working.
 *
 * Registration is skipped entirely on `http://` outside localhost. A service
 * worker on an insecure origin is a request the browser refuses anyway, and
 * attempting it logs a confusing error on preview hosts that terminate TLS
 * upstream.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    // Deferred past load so registration never competes with the first paint
    // of the page someone actually asked for.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration means no offline shell, which is a degraded
        // experience rather than a broken one. Nothing is surfaced.
      });
    };

    if (document.readyState === "complete") {
      const timer = window.setTimeout(register, 0);
      return () => window.clearTimeout(timer);
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
