import QRCode from "npm:qrcode@1.5.4";
import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { batchId: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    await requireProfile(request, ["admin", "manager"]);
    const { batchId } = await readJson<Body>(request);
    if (!batchId) throw new HttpError(400, "batchId is required");

    const admin = adminClient();
    const { data: batch, error } = await admin.from("batches")
      .select("batch_id,batch_code").eq("batch_id", batchId).single();
    if (error || !batch) throw new HttpError(404, "Batch not found");

    const traceUrl = `${Deno.env.get("QR_TRACE_BASE_URL")}/${batch.batch_id}`;
    const qrDataUrl = await QRCode.toDataURL(traceUrl, {
      errorCorrectionLevel: "M",
      width: 512,
      margin: 2,
    });
    const { error: updateError } = await admin.from("batches")
      .update({ qr_code: traceUrl }).eq("batch_id", batchId);
    if (updateError) throw updateError;
    return json(request, { batchId, batchCode: batch.batch_code, traceUrl, qrDataUrl });
  } catch (error) {
    return handleError(request, error);
  }
});
