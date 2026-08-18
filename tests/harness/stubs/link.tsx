import type { AnchorHTMLAttributes } from "react";

/** `next/link` is an anchor with prefetching; the layout only needs the anchor. */
export default function Link({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...rest} />;
}
