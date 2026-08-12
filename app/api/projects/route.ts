import { jsonNoStore } from "@/lib/server/http";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return jsonNoStore(
        { error: { code: "unauthorized", message: "Authentication is required." } },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .select("id,name,status")
      .neq("status", "archived")
      .order("name", { ascending: true })
      .limit(100);

    if (error) {
      return jsonNoStore(
        { error: { code: "database_error", message: "Projects could not be loaded." } },
        { status: 500 },
      );
    }

    return jsonNoStore({ projects: data ?? [] });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return jsonNoStore(
        {
          error: {
            code: "supabase_not_configured",
            message: "Project selection is unavailable because Supabase is not configured.",
          },
        },
        { status: 503 },
      );
    }

    return jsonNoStore(
      { error: { code: "internal_error", message: "Projects could not be loaded." } },
      { status: 500 },
    );
  }
}
