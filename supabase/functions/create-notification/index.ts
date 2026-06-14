import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { userId: string; title: string; content?: string; type?: string; targetUrl?: string };

function cleanOptional(value: string | undefined, maxLength: number, field: string) {
  const cleaned = value?.trim() || null;
  if (cleaned && cleaned.length > maxLength) {
    throw new HttpError(400, `${field} cannot exceed ${maxLength} characters`);
  }
  return cleaned;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    await requireProfile(request, ["admin", "manager"]);
    const body = await readJson<Body>(request);
    if (!body.userId || !body.title?.trim()) throw new HttpError(400, "userId and title are required");
    const title = body.title.trim();
    if (title.length > 160) throw new HttpError(400, "title cannot exceed 160 characters");
    const content = cleanOptional(body.content, 2000, "content");
    const type = cleanOptional(body.type, 80, "type");
    const targetUrl = cleanOptional(body.targetUrl, 500, "targetUrl");
    if (targetUrl && !targetUrl.startsWith("/")) {
      throw new HttpError(400, "targetUrl must be an application path");
    }

    const admin = adminClient();
    const target = await admin.from("users")
      .select("user_id,status")
      .eq("user_id", body.userId)
      .single();
    if (target.error || !target.data) throw new HttpError(404, "Notification recipient not found");
    if (target.data.status !== "active") {
      throw new HttpError(409, "Notifications can only be sent to active users");
    }

    const { data, error } = await admin.from("notifications").insert({
      user_id: body.userId,
      title,
      content,
      type,
      target_url: targetUrl,
    }).select().single();
    if (error) throw error;
    return json(request, { data }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
