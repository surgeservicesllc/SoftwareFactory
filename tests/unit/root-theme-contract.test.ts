// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const rootLayout = readFileSync(resolve(repositoryRoot, "app/layout.tsx"), "utf8");
const themeToggle = readFileSync(resolve(repositoryRoot, "components/theme-toggle.tsx"), "utf8");
const themeRuntime = readFileSync(resolve(repositoryRoot, "lib/theme.ts"), "utf8");
const bootstrapContract = `${rootLayout}\n${themeToggle}\n${themeRuntime}`;

describe("root colour-theme bootstrap", () => {
  it("ships dark in the server HTML and permits the pre-hydration correction", () => {
    expect(rootLayout).toMatch(
      /<html\b[^>]*\bdata-theme=(?:["']dark["']|\{DEFAULT_THEME\})[\s\S]*?>/,
    );
    expect(rootLayout).toMatch(/<html\b[^>]*\bsuppressHydrationWarning\b[\s\S]*?>/);
    expect(rootLayout).toMatch(/colorScheme:\s*["'](?:dark light|light dark)["']/);
  });

  it("runs the stored-theme bootstrap before body content can paint", () => {
    const html = rootLayout.indexOf("<html");
    const script = rootLayout.indexOf("<script", html);
    const body = rootLayout.indexOf("<body", html);

    expect(html).toBeGreaterThan(-1);
    expect(script, "root layout has no pre-hydration theme bootstrap").toBeGreaterThan(html);
    expect(script, "theme bootstrap is rendered after the body begins").toBeLessThan(body);
    expect(rootLayout.slice(script, body)).toMatch(/dangerouslySetInnerHTML|beforeInteractive/);

    expect(bootstrapContract).toContain("softwarefactory:color-theme");
    expect(bootstrapContract).toMatch(/localStorage\.getItem/);
    expect(bootstrapContract).toMatch(/dataset\.theme|setAttribute\(["']data-theme["']/);
    expect(bootstrapContract).toMatch(/(?:===|==)\s*["']light["']/);
    expect(bootstrapContract).toMatch(/(?:===|==)\s*["']dark["']/);
  });

  it("does not defer the first theme decision to a post-paint React effect", () => {
    const head = rootLayout.slice(rootLayout.indexOf("<html"), rootLayout.indexOf("<body"));
    expect(head).not.toMatch(/useEffect|useLayoutEffect/);
    expect(head).toMatch(/<script/);
  });
});
