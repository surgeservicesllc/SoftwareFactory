import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { refreshSupabaseAuth } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
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
    "/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
