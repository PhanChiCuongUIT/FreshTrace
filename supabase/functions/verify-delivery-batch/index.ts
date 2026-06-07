import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { requireProfile } from "../_shared/supabase.ts";

type Body = { deliveryId: string; batchId: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["admin", "manager", "employee"]);
    const body = await readJson<Body>(request);
    const { data, error } = await profile.client.rpc("verify_delivery_batch", {
      p_delivery_id: body.deliveryId,
      p_batch_id: body.batchId,
    });
    if (error) throw new HttpError(400, error.message);
    return json(request, { data });
  } catch (error) {
    return handleError(request, error);
  }
});
