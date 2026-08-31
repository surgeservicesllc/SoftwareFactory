"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import {
  DEFAULT_THEME,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  colorTheme,
  type ColorTheme,
} from "@/lib/theme";

export { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";

const themeListeners = new Set<() => void>();

function readDocumentTheme(): ColorTheme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return colorTheme(document.documentElement.getAttribute("data-theme"));
}

function readStoredTheme(): ColorTheme {
  try {
    return colorTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: ColorTheme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  const themeColor = theme === "light" ? "#f5f7fa" : "#0b0f14";
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = themeColor;
  }
}

function notifyThemeListeners() {
  for (const listener of themeListeners) listener();
}

function subscribeToTheme(listener: () => void) {
  themeListeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(colorTheme(event.newValue));
    listener();
  };
  const onThemeChange = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  };
}

function storeTheme(theme: ColorTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage is a convenience. The current document can still switch theme.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, readDocumentTheme, () => DEFAULT_THEME);
  const nextTheme: ColorTheme = theme === "dark" ? "light" : "dark";

  useLayoutEffect(() => {
    // React development remounts may restore the server's `dark` attribute.
    // Re-apply the same persisted source the pre-paint bootstrap reads.
    applyTheme(readStoredTheme());
    notifyThemeListeners();
  }, []);

  return (
    <button
      type="button"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "light"}
      data-theme-toggle=""
      onClick={() => storeTheme(nextTheme)}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface",
        "text-muted transition-colors hover:border-line-strong hover:bg-surface-raised hover:text-foreground",
        className,
      )}
    >
      {theme === "dark" ? (
        <Sun className="size-4.5" aria-hidden="true" />
      ) : (
        <Moon className="size-4.5" aria-hidden="true" />
      )}
    </button>
  );
}
