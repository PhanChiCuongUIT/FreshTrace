import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { requireProfile } from "../_shared/supabase.ts";

type Body = {
  deliveryId: string;
  method: "cash";
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["employee", "manager", "admin"]);
    const body = await readJson<Body>(request);
    if (!body.deliveryId || body.method !== "cash") {
      throw new HttpError(400, "Only a cash COD collection can be recorded manually");
    }
    const { data, error } = await profile.client.rpc("record_delivery_collection", {
      p_delivery_id: body.deliveryId,
      p_method: "cash",
      p_proof_url: null,
    });
    if (error) throw new HttpError(400, error.message);
    return json(request, { collectionId: data }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
