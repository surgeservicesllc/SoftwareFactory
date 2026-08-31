// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function cssBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing theme selector: ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  if (close === -1) throw new Error(`Unclosed theme selector: ${selector}`);
  return source.slice(open + 1, close);
}

function hexToken(block: string, token: string): string {
  const match = block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match?.[1]) throw new Error(`Missing six-digit colour token: ${token}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => (
    Number.parseInt(channel, 16) / 255
  ));
  if (!channels || channels.length !== 3) throw new Error(`Invalid colour: ${hex}`);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const high = Math.max(relativeLuminance(first), relativeLuminance(second));
  const low = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (high + 0.05) / (low + 0.05);
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

const VISUAL_LAYOUT_OWNERS = new Map<string, string>([
  ["app/(marketing)/layout.tsx", "components/marketing/site-header.tsx"],
  ["app/auth/layout.tsx", "components/marketing/site-header.tsx"],
  ["app/decision/layout.tsx", "components/marketing/site-header.tsx"],
  ["app/(portal)/layout.tsx", "components/marketing/site-header.tsx"],
  ["app/(budget)/layout.tsx", "components/marketing/site-header.tsx"],
  ["app/(services)/layout.tsx", "components/marketing/site-header.tsx"],
  ["app/(factory)/solutions/factory/layout.tsx", "components/graph/factory-shell.tsx"],
  ["app/(customer)/layout.tsx", "app/(customer)/layout.tsx"],
  // This nested layout only constrains the content width. Its visual theme and
  // control come from the parent customer layout above.
  ["app/(customer)/customer-portal/layout.tsx", "app/(customer)/layout.tsx"],
]);

describe("global colour-theme layout coverage", () => {
  it("registers every visual layout group instead of silently exempting a new shell", async () => {
    const layoutFiles = (await walk(resolve(repositoryRoot, "app")))
      .filter((file) => file.endsWith("layout.tsx"));

    const visual: string[] = [];
    for (const file of layoutFiles) {
      const source = await readFile(file, "utf8");
      if (
        source.includes("className=")
        || source.includes("<SiteHeader")
        || source.includes("<AppShell")
        || source.includes("<BudgetShell")
        || source.includes("<ServicesShell")
        || source.includes("factory-theme")
      ) {
        visual.push(relative(repositoryRoot, file).replaceAll("\\", "/"));
      }
    }

    expect(visual.sort()).toEqual([...VISUAL_LAYOUT_OWNERS.keys()].sort());
  });

  it("makes the toggle reachable from every interactive visual shell", async () => {
    for (const [layout, owner] of VISUAL_LAYOUT_OWNERS) {
      const layoutSource = await readFile(resolve(repositoryRoot, layout), "utf8");
      const ownerSource = await readFile(resolve(repositoryRoot, owner), "utf8");

      if (owner.endsWith("site-header.tsx")) {
        expect(layoutSource, `${layout} no longer renders the shared themed header`)
          .toContain("<SiteHeader");
      }
      expect(ownerSource, `${layout} cannot reach the global theme control through ${owner}`)
        .toMatch(/\bThemeToggle\b/);
    }
  });

  it("keeps both product-specific token scopes responsive to the global choice", async () => {
    const css = await readFile(resolve(repositoryRoot, "app/globals.css"), "utf8");

    for (const scope of ["factory-theme", "services-theme"]) {
      expect(css, `${scope} has no dark-default palette`).toMatch(
        new RegExp(`(?:^|\\n)\\.${scope}\\s*\\{`),
      );
      expect(css, `${scope} has no explicit light palette`).toMatch(
        new RegExp(`(?:data-theme=["']light["'][^,{]*[ .]|\\[data-theme=["']light["']\\][^,{]*[ .])\\.${scope}`),
      );
    }
  });

  it("lets the offline surface inherit the selected semantic palette", async () => {
    const source = await readFile(resolve(repositoryRoot, "app/offline/page.tsx"), "utf8");
    expect(source).toContain("bg-background");
    expect(source).toContain("text-foreground");
    expect(source).not.toMatch(/(?:background|color|bg|text)-?\[?#(?:fff(?:fff)?|000(?:000)?)\]?/i);
  });

  it("keeps every semantic text token at AA contrast on every token surface", async () => {
    const css = await readFile(resolve(repositoryRoot, "app/globals.css"), "utf8");
    const scopes = [
      {
        name: "root dark",
        selector: ":root",
        text: ["--text", "--text-muted", "--text-faint"],
        surfaces: ["--bg", "--surface", "--surface-raised"],
      },
      {
        name: "root light",
        selector: 'html[data-theme="light"]',
        text: ["--text", "--text-muted", "--text-faint"],
        surfaces: ["--bg", "--surface", "--surface-raised"],
      },
      {
        name: "Factory dark",
        selector: ".factory-theme",
        text: ["--text", "--text-muted", "--text-faint"],
        surfaces: ["--bg", "--surface", "--surface-raised"],
      },
      {
        name: "Factory light",
        selector: 'html[data-theme="light"] .factory-theme',
        text: ["--text", "--text-muted", "--text-faint"],
        surfaces: ["--bg", "--surface", "--surface-raised"],
      },
      {
        name: "Services dark",
        selector: ".services-theme",
        text: ["--text", "--text-muted", "--text-faint"],
        surfaces: ["--bg", "--surface", "--surface-raised"],
      },
      {
        name: "Services light",
        selector: 'html[data-theme="light"] .services-theme',
        text: ["--text", "--text-muted", "--text-faint"],
        surfaces: ["--bg", "--surface", "--surface-raised"],
      },
      {
        name: "site dark",
        selector: ":root",
        text: ["--site-text", "--site-muted", "--site-faint"],
        surfaces: ["--site-bg", "--site-surface", "--site-surface-raised"],
      },
      {
        name: "site light",
        selector: 'html[data-theme="light"]',
        text: ["--site-text", "--site-muted", "--site-faint"],
        surfaces: ["--site-bg", "--site-surface", "--site-surface-raised"],
      },
    ] as const;

    for (const scope of scopes) {
      const block = cssBlock(css, scope.selector);
      for (const textToken of scope.text) {
        for (const surfaceToken of scope.surfaces) {
          const foreground = hexToken(block, textToken);
          const background = hexToken(block, surfaceToken);
          expect(
            contrastRatio(foreground, background),
            `${scope.name}: ${textToken} ${foreground} on ${surfaceToken} ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
