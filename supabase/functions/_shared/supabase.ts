import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";
import { HttpError } from "./http.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(request: Request): SupabaseClient {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new HttpError(401, "Missing Authorization header");
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireProfile(
  request: Request,
  allowedRoles?: string[],
): Promise<{ userId: string; authUserId: string; role: string; client: SupabaseClient }> {
  const client = userClient(request);
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw new HttpError(401, "Invalid or expired session");

  const admin = adminClient();
  const { data: profile, error } = await admin
    .from("users")
    .select("user_id, auth_user_id, status, roles!inner(role_name)")
    .eq("auth_user_id", authData.user.id)
    .single();

  if (error || !profile || profile.status !== "active") {
    throw new HttpError(403, "User profile is unavailable");
  }

  const role = (profile.roles as unknown as { role_name: string }).role_name;
  if (allowedRoles && !allowedRoles.includes(role)) throw new HttpError(403, "Forbidden");
  return { userId: profile.user_id, authUserId: profile.auth_user_id, role, client };
}
