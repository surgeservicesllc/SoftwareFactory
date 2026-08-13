/**
 * Whether the browser bundle has enough Supabase configuration to be worth
 * making a request at all.
 *
 * These values are inlined at build time. When they are absent every tenant
 * read is guaranteed to fail, so callers should skip the request rather than
 * fire one that can only return an error — an unconfigured environment should
 * look like "sign in required", not like a broken page full of failed calls.
 *
 * This is not an authorization check. The server still authenticates and
 * applies RLS to every request regardless of what the browser believes.
 */
export function isBrowserSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    && (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    ),
  );
}
