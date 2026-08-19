/** Enough of `next/navigation` for components that read the current path. */
export function usePathname(): string {
  return new URLSearchParams(window.location.search).get("path") ?? "/solutions";
}

export function useRouter() {
  return { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} };
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
