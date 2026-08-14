import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const externalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
  !process.env.PLAYWRIGHT_WEB_SERVER_COMMAND;

// Opt-in escape hatch for environments that provide a Chromium build other than
// the revision this Playwright version pins. Unset in CI, so the verified
// browser remains the release gate; setting it only redirects the executable.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
const chromiumLaunch = chromiumExecutable
  ? { launchOptions: { executablePath: chromiumExecutable } }
  : {};

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
        ...chromiumLaunch,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...chromiumLaunch,
        viewport: { width: 834, height: 1112 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        ...chromiumLaunch,
      },
    },
  ],
  webServer: externalServer
    ? undefined
    : {
        command:
          process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
          "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
