import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    const url = new URL(request.url);
    const batchId = url.searchParams.get("batchId");
    const code = url.searchParams.get("code");
    if (!batchId && !code) throw new HttpError(400, "batchId or code is required");

    let query = adminClient().from("batches").select(`
      batch_id,batch_code,harvest_date,expire_date,origin_location,status,qr_code,
      products!inner(product_id,name,description,unit,image_url,certificate,status),
      suppliers(name,address,certificate,status),
      inventory(quantity_available)
    `);
    query = batchId ? query.eq("batch_id", batchId) : query.eq("batch_code", code!);
    const { data, error } = await query.single();
    if (error || !data) throw new HttpError(404, "Traceability record not found");
    return json(request, { data });
  } catch (error) {
    return handleError(request, error);
  }
});
