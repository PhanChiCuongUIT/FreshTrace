import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { requireProfile } from "../_shared/supabase.ts";

type Body = {
  deliveryId: string;
  method: "cash" | "bank_transfer" | "customer_payos";
  proofUrl?: string;
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["employee", "manager", "admin"]);
    const body = await readJson<Body>(request);
    if (!body.deliveryId || !["cash", "bank_transfer", "customer_payos"].includes(body.method)) {
      throw new HttpError(400, "deliveryId and a valid method are required");
    }
    const { data, error } = await profile.client.rpc("record_delivery_collection", {
      p_delivery_id: body.deliveryId,
      p_method: body.method,
      p_proof_url: body.proofUrl ?? null,
    });
    if (error) throw new HttpError(400, error.message);
    return json(request, { collectionId: data }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
