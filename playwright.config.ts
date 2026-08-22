import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const externalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
  !process.env.PLAYWRIGHT_WEB_SERVER_COMMAND;
// Sandboxes and CI images often ship a Chromium build that does not match the
// revision this Playwright version downloads. Pointing at that binary is safer
// than re-downloading; unset, Playwright resolves its own managed browser.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
/** Where the component layout harness is served. */
export const HARNESS_URL = process.env.PLAYWRIGHT_HARNESS_URL ?? "http://localhost:4321";
const launchOptions = chromiumExecutable
  ? { executablePath: chromiumExecutable }
  : undefined;
/*
 * Sandboxes that mandate an egress proxy export HTTPS_PROXY and trust its
 * CA in the browser's NSS store — but Chromium only routes through it when
 * told. Engage the proxy only for a remote HTTPS target: local runs
 * (localhost app + harness) stay direct, and environments without a
 * mandated proxy see no change.
 */
const proxyServer = baseURL.startsWith("https://")
  ? process.env.HTTPS_PROXY ?? process.env.https_proxy
  : undefined;
const proxy = proxyServer
  ? { server: proxyServer, bypass: "localhost,127.0.0.1" }
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // A cold Next.js development compiler can be overwhelmed by one worker per
  // test on high-core machines. Three workers preserve viewport parallelism
  // without turning startup into a false timeout.
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  expect: {
    timeout: 10_000,
  },
  timeout: 45_000,
  use: {
    baseURL,
    ...(proxy ? { proxy } : {}),
    /*
     * No locator action waits forever.
     *
     * Playwright's default `actionTimeout` is 0 — unbounded — so a click or a
     * `textContent()` on an element that is not there consumes the whole test
     * budget and then reports as a timeout with no bearing on the cause. It
     * has now cost two debugging sessions: an untimed `textContent()` in the
     * interactive sweep hung 86 checks, and an untimed `click()` on a drawer
     * that had already closed hung every mobile page check. A bound well under
     * the 45s test timeout turns both into a named failure at the line that
     * caused them.
     */
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "test-results",
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions,
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 834, height: 1112 },
        launchOptions,
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        launchOptions,
      },
    },
  ],
  /*
   * Two servers: the application, and a static build of the layout harness.
   *
   * The harness exists because the console resolves its tenant on the server —
   * without Supabase the browser suite only ever reaches the "not configured"
   * gate, so every layout that appears once there are rows went unmeasured.
   * It is served over HTTP rather than opened from disk because ES modules
   * cannot load over file://.
   */
  webServer: [
    ...(externalServer
      ? []
      : [{
        command:
          process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
          "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }]),
    {
      /*
       * Rebuilt every run, never reused.
       *
       * `vite preview` serves a compiled artifact, and Playwright's
       * `reuseExistingServer` is on outside CI — so the first local run built
       * the bundle and every run afterwards reused that server and skipped the
       * build. A preview started hours earlier answered every request, and the
       * width sweep passed against components that had since changed. It was
       * caught by breaking a layout on purpose and watching the suite stay
       * green, and CI never saw it, which is the worst shape for this: it only
       * misleads the machine drawing the conclusions.
       *
       * `false` here rather than a dev server, because a dev server compiling
       * every module on request took this suite from ten minutes to over
       * twenty-five. One build per run is the cheap half of that trade.
       */
      command: "npm run harness:build && npm run harness:serve",
      url: HARNESS_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
