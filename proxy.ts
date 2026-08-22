import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { MARKETING_RESOURCES } from "@/lib/marketing/content";
import { refreshSupabaseAuth } from "@/lib/supabase/proxy";

const RESOURCE_SLUGS = new Set(MARKETING_RESOURCES.map((resource) => resource.slug));
const RESOURCE_IMAGE_ROUTES = new Set([
  "opengraph-image-5fam9d",
  "twitter-image-5fam9d",
]);

function isUnknownResourcePath(pathname: string) {
  const match = /^\/resources\/([^/]+)\/?$/.exec(pathname);
  return Boolean(
    match &&
      !RESOURCE_SLUGS.has(match[1]) &&
      !RESOURCE_IMAGE_ROUTES.has(match[1]),
  );
}

export async function proxy(request: NextRequest) {
  // This route sits below the root loading boundary. Rejecting an unknown
  // dynamic slug in the page can therefore happen after Next has streamed a
  // 200 shell. Rewrite it to the app's real not-found route at the request
  // boundary so both the branded body and the HTTP status are correct.
  if (isUnknownResourcePath(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }

  try {
    return await refreshSupabaseAuth(request);
  } catch {
    // Keep the public, disconnected experience available until Supabase is
    // configured. Secure route handlers still fail closed in their DAL.
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    // Resource slugs may legitimately contain a dot. Keep this scoped matcher
    // ahead of the global static-image exclusion so an unknown `*.png`-style
    // slug still reaches the real-404 guard above.
    "/resources/:path*",
    "/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
