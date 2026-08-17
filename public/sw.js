
/**
 * The offline shell.
 *
 * A service worker sits between every request this origin makes and the
 * network, which makes what it *refuses* to cache more important than what it
 * caches. Three rules, and the first two are the ones that would cause real
 * harm if they were wrong.
 *
 *   Never cache an API response. Every /api/ route here is tenant-scoped, and
 *   several answer questions about credentials and autonomy state. A cached
 *   answer could be served to a different signed-in person on a shared device,
 *   or outlive a sign-out, or report a provider as connected after it was
 *   disconnected. These always go to the network and never enter a cache.
 *
 *   Never cache a navigation for an authenticated surface. Same reasoning: a
 *   console page shows tenant data. What is cached is one deliberately empty
 *   offline page, shown only when the network genuinely fails.
 *
 *   Only cache what the build produced. Static assets are content-hashed by
 *   Next, so caching them is safe and a stale one cannot exist.
 */

const VERSION = "v1";
const SHELL_CACHE = `softwarefactory-shell-${VERSION}`;
const ASSET_CACHE = `softwarefactory-assets-${VERSION}`;
const OFFLINE_URL = "/offline";

const SHELL_ASSETS = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      // Taking over immediately matters for a worker whose job is partly to
      // stop caching things a previous version cached.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** True for anything that must never be served from a cache. */
function isNeverCacheable(url, request) {
  return url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/auth/")
    || request.method !== "GET"
    // A cross-origin response is not ours to reason about.
    || url.origin !== self.location.origin;
}

/** Content-hashed build output, safe to cache indefinitely. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/")
    || /\.(?:png|svg|ico|woff2?)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isNeverCacheable(url, event.request)) return;

  if (event.request.mode === "navigate") {
    // Network-first, with the offline page as the only fallback. The page
    // itself is never cached, so nothing tenant-scoped can be replayed.
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      }),
    );
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
        // Only a complete, same-origin success is worth keeping. Caching an
        // opaque or partial response would poison the entry.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })),
    );
  }
});

/**
 * Web push.
 *
 * The spec asks for a push when something finishes or needs a decision. The
 * handler is here so the contract is fixed, but nothing sends one yet: that
 * needs VAPID keys, which are not configured. A notification is shown only for
 * a payload the server actually sent — this never invents one, because a push
 * that says nothing real trains people to ignore the channel.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  if (!payload || typeof payload.title !== "string") return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: typeof payload.body === "string" ? payload.body : undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      data: { url: typeof payload.url === "string" ? payload.url : "/solutions/agentos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/solutions/agentos";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing window rather than opening a second one: a person
      // tapping a notification means "show me", not "give me another tab".
      for (const client of clientList) {
        if (client.url.includes(target) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
