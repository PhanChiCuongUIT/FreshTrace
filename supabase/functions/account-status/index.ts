import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

type Body = {
  email: string;
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const body = await readJson<Body>(request);
    const email = body.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new HttpError(400, "A valid email is required");

    const { data, error } = await adminClient().from("users")
      .select("status")
      .ilike("email", email)
      .maybeSingle();
    if (error) throw error;

    if (data?.status === "banned") {
      return json(request, {
        allowed: false,
        status: "banned",
        message: "This account has been banned and cannot sign in, register again, or reset password.",
      }, 403);
    }
    if (data?.status === "inactive") {
      return json(request, {
        allowed: false,
        status: "inactive",
        message: "This account is inactive. Please contact the FreshTrace admin who changed the account status or support@freshtrace.online.",
      }, 403);
    }

    return json(request, { allowed: true });
  } catch (error) {
    return handleError(request, error);
  }
});
