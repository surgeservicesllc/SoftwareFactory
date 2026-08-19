import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Maps the `server-only` marker to the empty module the package itself ships
 * for react-server environments. Next.js uses the marker to keep server code
 * out of client bundles; a Node worker process is server code, so the marker
 * has nothing to protect here — but its default export simply throws. This
 * shim is scoped to that one specifier: every other package resolves exactly
 * as before, which is why it is used instead of `--conditions react-server`.
 *
 * Loaded with `node --import` (via NODE_OPTIONS) in front of tsx, so worker
 * scripts can share modules with the Next.js app without a parallel copy.
 */
const empty = pathToFileURL(
  path.join(process.cwd(), "node_modules", "server-only", "empty.js"),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: empty, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
