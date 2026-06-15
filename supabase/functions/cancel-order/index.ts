import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { orderId: string; reason?: string };
type PayosStatusResponse = {
  code?: string;
  data?: {
    id?: string;
    orderCode?: number;
    amountPaid?: number;
    amountRemaining?: number;
    status?: string;
    transactions?: unknown;
  };
};

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProviderPaid(data: PayosStatusResponse["data"], expectedAmount: unknown) {
  const status = String(data?.status ?? "").toUpperCase();
  const remaining = data?.amountRemaining == null ? null : numeric(data.amountRemaining);
  const amount = numeric(expectedAmount);
  const paid = numeric(data?.amountPaid);
  return status === "PAID" || remaining === 0 || (amount > 0 && paid >= amount);
}

function extractTransactionId(data: PayosStatusResponse["data"]) {
  const transactions = data?.transactions;
  if (Array.isArray(transactions)) {
    const first = transactions[0] as Record<string, unknown> | undefined;
    return String(first?.reference ?? first?.transactionId ?? data?.id ?? data?.orderCode ?? "").trim() || null;
  }
  if (transactions && typeof transactions === "object") {
    const first = Object.values(transactions as Record<string, unknown>)
      .find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
    return String(first?.reference ?? first?.transactionId ?? data?.id ?? data?.orderCode ?? "").trim() || null;
  }
  return String(data?.id ?? data?.orderCode ?? "").trim() || null;
}

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
      payments!inner(payment_id,method,status,provider_order_code)
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
      const paymentId = String(payment.payment_id);
      const providerOrderCode = Number(payment.provider_order_code);
      const requestResult = await admin.from("payos_requests")
        .select("request_id,amount,status")
        .eq("payment_id", paymentId)
        .eq("provider_order_code", providerOrderCode)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestResult.error) throw requestResult.error;
      const statusResponse = await fetch(
        `https://api-merchant.payos.vn/v2/payment-requests/${providerOrderCode}`,
        {
          headers: {
            "x-client-id": Deno.env.get("PAYOS_CLIENT_ID")!,
            "x-api-key": Deno.env.get("PAYOS_API_KEY")!,
          },
        },
      );
      const provider = await statusResponse.json() as PayosStatusResponse;
      if (statusResponse.ok && provider.code === "00" && provider.data) {
        const providerStatus = String(provider.data.status ?? "").toUpperCase();
        if (isProviderPaid(provider.data, requestResult.data?.amount)) {
          const confirmation = await admin.rpc("confirm_payos_request", {
            p_provider_order_code: providerOrderCode,
            p_amount: requestResult.data?.amount ?? numeric(provider.data.amountPaid),
            p_transaction_id: extractTransactionId(provider.data),
            p_payload: { source: "cancel-order-precheck", provider },
          });
          if (confirmation.error) throw new HttpError(409, confirmation.error.message);
          payment.status = "paid";
        } else if (["CANCELLED", "EXPIRED", "FAILED"].includes(providerStatus) && requestResult.data?.request_id) {
          await admin.from("payos_requests")
            .update({
              status: providerStatus === "CANCELLED" ? "cancelled" : "failed",
              provider_payload: provider,
              updated_at: new Date().toISOString(),
            })
            .eq("request_id", requestResult.data.request_id)
            .eq("status", "pending");
        }
      }
    }

    if (payment.status !== "paid" && payment.method === "payos" && payment.provider_order_code) {
      const providerOrderCode = Number(payment.provider_order_code);
      const response = await fetch(
        `https://api-merchant.payos.vn/v2/payment-requests/${providerOrderCode}/cancel`,
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
