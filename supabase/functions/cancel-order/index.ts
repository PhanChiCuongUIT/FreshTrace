import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { orderId: string; reason?: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const actor = await requireProfile(request, ["customer", "admin", "manager"]);
    const body = await readJson<Body>(request);
    if (!body.orderId) throw new HttpError(400, "orderId is required");
    const reason = body.reason?.trim() || "Order cancelled by user";

    const admin = adminClient();
    const { data: order, error } = await admin.from("orders").select(`
      order_id,user_id,status,
      payments!inner(method,status,provider_order_code)
    `).eq("order_id", body.orderId).single();
    if (error || !order) throw new HttpError(404, "Order not found");
    if (actor.role === "customer" && order.user_id !== actor.userId) {
      throw new HttpError(403, "Forbidden");
    }
    if (order.status !== "pending") {
      throw new HttpError(409, "Only pending orders can be cancelled");
    }

    const rawPayment = order.payments as unknown as Record<string, unknown> | Array<Record<string, unknown>>;
    const payment = Array.isArray(rawPayment) ? rawPayment[0] : rawPayment;
    if (!payment) throw new HttpError(404, "Payment record not found");
    if (payment.status !== "paid" && payment.method === "payos" && payment.provider_order_code) {
      const response = await fetch(
        `https://api-merchant.payos.vn/v2/payment-requests/${payment.provider_order_code}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-client-id": Deno.env.get("PAYOS_CLIENT_ID")!,
            "x-api-key": Deno.env.get("PAYOS_API_KEY")!,
          },
          body: JSON.stringify({ cancellationReason: reason }),
        },
      );
      const result = await response.json();
      if (!response.ok || result.code !== "00") {
        console.error("payOS cancellation failed", result);
        throw new HttpError(502, "Could not cancel the payOS payment link");
      }
    }

    const { data: couponCode, error: cancelError } = await admin.rpc("cancel_order_service", {
      p_order_id: body.orderId,
      p_reason: reason,
      p_actor_id: actor.userId,
      p_issue_coupon: true,
    });
    if (cancelError) throw new HttpError(409, cancelError.message);
    return json(request, { success: true, couponCode: couponCode ?? null });
  } catch (error) {
    return handleError(request, error);
  }
});
