import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { requireProfile } from "../_shared/supabase.ts";

type Body = {
  deliveryId: string;
  status: "picked_up" | "delivering" | "delivered" | "failed";
  note?: string;
  proofImageUrl?: string;
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["admin", "manager", "employee"]);
    const body = await readJson<Body>(request);
    const { error } = await profile.client.rpc("update_delivery_status", {
      p_delivery_id: body.deliveryId,
      p_status: body.status,
      p_note: body.note ?? null,
      p_proof_image_url: body.proofImageUrl ?? null,
    });
    if (error) throw new HttpError(400, error.message);
    return json(request, { success: true });
  } catch (error) {
    return handleError(request, error);
  }
});
