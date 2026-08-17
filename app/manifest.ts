import type { MetadataRoute } from "next";

/**
 * The installable app definition.
 *
 * `docs/AGENTOS_SPEC.md` §12 asks for a mobile-responsive, installable surface
 * whose home is the inbox — the interrupt channel where an agent asks a human
 * for a decision. That is the whole reason this is a PWA rather than a
 * bookmark: the point of installing is that a question reaches someone away
 * from their desk.
 *
 * `start_url` is the AgentOS console, which carries the inbox, for the same
 * reason. Opening the installed app on the dashboard would put a summary
 * between a person and the thing waiting on them. When the inbox gets its own
 * route this should follow it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SoftwareFactory Control Plane",
    short_name: "SoftwareFactory",
    description:
      "Review what the factory decided, answer what it is waiting on, and watch runs as they happen.",
    start_url: "/solutions/agentos",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0f16",
    theme_color: "#0b0f16",
    categories: ["developer", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate entry: a platform that crops to a circle needs a mark drawn
      // inside the safe zone, and reusing the `any` icon gets its edges cut off.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Inbox",
        short_name: "Inbox",
        description: "Questions an agent is waiting on",
        url: "/solutions/agentos",
      },
      {
        name: "Activity",
        short_name: "Activity",
        description: "What the factory has been doing",
        url: "/solutions/activity",
      },
    ],
  };
}
