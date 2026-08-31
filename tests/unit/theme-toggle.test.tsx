import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  ThemeToggle,
} from "@/components/theme-toggle";

function currentTheme() {
  return document.documentElement.dataset.theme;
}

function dispatchThemeStorage(newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", {
      key: THEME_STORAGE_KEY,
      newValue,
    }));
  });
}

describe("global colour theme toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = DEFAULT_THEME;
    document.documentElement.style.colorScheme = DEFAULT_THEME;
  });

  it("exports one stable dark-default storage contract", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("softwarefactory:color-theme");
  });

  it("is an accessible button whose name describes the available change", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const useLight = screen.getByRole("button", { name: /(?:switch|change|use).+light/i });
    expect(useLight).toHaveAttribute("type", "button");
    expect(currentTheme()).toBe("dark");

    await user.click(useLight);

    expect(await screen.findByRole("button", { name: /(?:switch|change|use).+dark/i }))
      .toBeInTheDocument();
    expect(currentTheme()).toBe("light");
  });

  it("persists the explicit choice and restores it on a fresh mount", async () => {
    const user = userEvent.setup();
    const first = render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /(?:switch|change|use).+light/i }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    first.unmount();
    document.documentElement.dataset.theme = DEFAULT_THEME;
    document.documentElement.style.colorScheme = DEFAULT_THEME;
    render(<ThemeToggle />);

    await waitFor(() => expect(currentTheme()).toBe("light"));
    expect(screen.getByRole("button", { name: /(?:switch|change|use).+dark/i }))
      .toBeInTheDocument();
  });

  it("synchronizes an explicit choice made in another tab", async () => {
    render(<ThemeToggle />);

    dispatchThemeStorage("light");
    await waitFor(() => expect(currentTheme()).toBe("light"));
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(screen.getByRole("button", { name: /(?:switch|change|use).+dark/i }))
      .toBeInTheDocument();

    dispatchThemeStorage("dark");
    await waitFor(() => expect(currentTheme()).toBe("dark"));
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(screen.getByRole("button", { name: /(?:switch|change|use).+light/i }))
      .toBeInTheDocument();
  });

  it("ignores unrelated storage and falls back to dark for missing or invalid values", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    document.documentElement.dataset.theme = "sepia";
    render(<ThemeToggle />);

    await waitFor(() => expect(currentTheme()).toBe(DEFAULT_THEME));
    expect(screen.getByRole("button", { name: /(?:switch|change|use).+light/i }))
      .toBeInTheDocument();

    dispatchThemeStorage("light");
    await waitFor(() => expect(currentTheme()).toBe("light"));

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "some-other-preference",
        newValue: "dark",
      }));
    });
    expect(currentTheme()).toBe("light");

    dispatchThemeStorage("not-a-theme");
    await waitFor(() => expect(currentTheme()).toBe(DEFAULT_THEME));

    dispatchThemeStorage(null);
    await waitFor(() => expect(currentTheme()).toBe(DEFAULT_THEME));
  });
});
