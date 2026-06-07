import QRCode from "npm:qrcode@1.5.4";
import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { batchId?: string; batchCode?: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    await requireProfile(request);
    const { batchId, batchCode } = await readJson<Body>(request);
    if (!batchId && !batchCode) throw new HttpError(400, "batchId or batchCode is required");

    const admin = adminClient();
    let query = admin.from("batches").select("batch_id,batch_code");
    query = batchId ? query.eq("batch_id", batchId) : query.eq("batch_code", batchCode);
    const { data: batch, error } = await query.single();
    if (error || !batch) throw new HttpError(404, "Batch not found");

    const traceUrl = `${Deno.env.get("QR_TRACE_BASE_URL")}/${batch.batch_id}`;
    const qrDataUrl = await QRCode.toDataURL(traceUrl, {
      errorCorrectionLevel: "M",
      width: 512,
      margin: 2,
    });
    await admin.from("batches").update({ qr_code: traceUrl }).eq("batch_id", batch.batch_id);
    return json(request, { batchId: batch.batch_id, batchCode: batch.batch_code, traceUrl, qrDataUrl });
  } catch (error) {
    return handleError(request, error);
  }
});
