import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { verifyHmac } from "../_shared/signature.ts";

type Webhook = {
  code: string;
  success: boolean;
  data: Record<string, unknown> & {
    orderCode?: number;
    amount?: number;
    reference?: string;
    code?: string;
  };
  signature: string;
};

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const body = await readJson<Webhook>(request);
    if (!body.data || !body.signature) throw new HttpError(400, "Invalid webhook payload");
    const valid = await verifyHmac(body.data, body.signature, Deno.env.get("PAYOS_CHECKSUM_KEY")!);
    if (!valid) throw new HttpError(401, "Invalid webhook signature");

    // payOS sends a signed sample event when registering the webhook.
    if (!body.success || body.data.code !== "00") return json(request, { success: true, ignored: true });

    const admin = adminClient();
    const { error } = await admin.rpc("confirm_payos_request", {
      p_provider_order_code: body.data.orderCode,
      p_amount: body.data.amount,
      p_transaction_id: body.data.reference ?? null,
      p_payload: body,
    });
    if (error?.message?.includes("Payment request not found")) {
      return json(request, { success: true, ignored: true });
    }
    if (error) throw error;
    return json(request, { success: true });
  } catch (error) {
    return handleError(request, error);
  }
});
