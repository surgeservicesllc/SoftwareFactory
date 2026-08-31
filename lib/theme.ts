export const DEFAULT_THEME = "dark" as const;
export const THEME_STORAGE_KEY = "softwarefactory:color-theme";
export const THEME_CHANGE_EVENT = "softwarefactory:theme-change";

export type ColorTheme = "dark" | "light";

export function colorTheme(value: string | null | undefined): ColorTheme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

/**
 * Runs while the HTML parser is still in <head>, before first paint. Keep this
 * self-contained: localStorage is deliberately the only input so reading a
 * theme never makes the root layout dynamic.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});t=t==="light"?"light":"dark";d.setAttribute("data-theme",t);d.style.colorScheme=t;var c=t==="light"?"#f5f7fa":"#0b0f14";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})}catch(e){document.documentElement.setAttribute("data-theme","dark");document.documentElement.style.colorScheme="dark"}})()`;
