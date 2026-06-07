import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { requireProfile } from "../_shared/supabase.ts";

type Body = { orderId: string; employeeId: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["admin", "manager"]);
    const body = await readJson<Body>(request);
    const { data, error } = await profile.client.rpc("assign_delivery", {
      p_order_id: body.orderId,
      p_employee_id: body.employeeId,
    });
    if (error) throw new HttpError(400, error.message);
    return json(request, { deliveryId: data }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
