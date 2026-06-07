import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { userId: string; title: string; content?: string; type?: string; targetUrl?: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    await requireProfile(request, ["admin", "manager"]);
    const body = await readJson<Body>(request);
    if (!body.userId || !body.title?.trim()) throw new HttpError(400, "userId and title are required");
    const { data, error } = await adminClient().from("notifications").insert({
      user_id: body.userId,
      title: body.title.trim(),
      content: body.content,
      type: body.type,
      target_url: body.targetUrl,
    }).select().single();
    if (error) throw error;
    return json(request, { data }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
