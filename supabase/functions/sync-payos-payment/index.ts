import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = {
  orderId?: string;
  providerOrderCode?: number;
  purpose?: "checkout" | "customer_cod" | "shipper_remittance";
};
type PayosRequest = {
  request_id: string;
  payment_id: string;
  delivery_id: string | null;
  collection_id: string | null;
  purpose: "checkout" | "customer_cod" | "shipper_remittance";
  provider_order_code: number;
  amount: number | string;
  status: "pending" | "paid" | "cancelled" | "failed";
};
type PayosStatusResponse = {
  code?: string;
  desc?: string;
  data?: {
    id?: string;
    orderCode?: number;
    amount?: number;
    amountPaid?: number;
    amountRemaining?: number;
    status?: string;
    transactions?: unknown;
  };
  signature?: string;
};

function extractTransactionId(data: PayosStatusResponse["data"]): string | null {
  const transactions = data?.transactions;
  if (Array.isArray(transactions)) {
    const first = transactions[0] as Record<string, unknown> | undefined;
    return String(first?.reference ?? first?.transactionId ?? data?.id ?? data?.orderCode ?? "").trim() || null;
  }
  if (transactions && typeof transactions === "object") {
    const values = Object.values(transactions as Record<string, unknown>);
    const first = values.find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
    return String(first?.reference ?? first?.transactionId ?? data?.id ?? data?.orderCode ?? "").trim() || null;
  }
  return String(data?.id ?? data?.orderCode ?? "").trim() || null;
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProviderPaid(data: PayosStatusResponse["data"], expectedAmount: number | string) {
  const providerStatus = String(data?.status ?? "").toUpperCase();
  const amount = numeric(expectedAmount);
  const paid = numeric(data?.amountPaid);
  const remaining = data?.amountRemaining == null ? null : numeric(data.amountRemaining);
  return providerStatus === "PAID" || (amount > 0 && paid >= amount) || remaining === 0;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request);
    const { orderId, providerOrderCode, purpose } = await readJson<Body>(request);
    if (!providerOrderCode && !orderId) {
      throw new HttpError(400, "providerOrderCode or orderId is required");
    }

    const admin = adminClient();
    let paymentId: string | null = null;
    if (!providerOrderCode && orderId) {
      const payment = await admin.from("payments")
        .select("payment_id")
        .eq("order_id", orderId)
        .single();
      if (payment.error || !payment.data) throw new HttpError(404, "Payment not found");
      paymentId = payment.data.payment_id;
    }

    let query = admin.from("payos_requests")
      .select("request_id,payment_id,delivery_id,collection_id,purpose,provider_order_code,amount,status")
      .order("created_at", { ascending: false })
      .limit(1);
    if (providerOrderCode) query = query.eq("provider_order_code", providerOrderCode);
    if (paymentId) query = query.eq("payment_id", paymentId);
    if (purpose) query = query.eq("purpose", purpose);
    const payosRequest = await query.maybeSingle();
    if (payosRequest.error || !payosRequest.data) throw new HttpError(404, "payOS request not found");
    const localRequest = payosRequest.data as PayosRequest;

    const payment = await admin.from("payments")
      .select("payment_id,order_id,method,status,orders!inner(order_id,user_id,status)")
      .eq("payment_id", localRequest.payment_id)
      .single();
    if (payment.error || !payment.data) throw new HttpError(404, "Payment record not found");
    const order = Array.isArray(payment.data.orders) ? payment.data.orders[0] : payment.data.orders;
    if (!order) throw new HttpError(404, "Order not found");

    let delivery: { delivery_id: string; employee_id: string | null; status: string } | null = null;
    if (localRequest.delivery_id) {
      const deliveryResult = await admin.from("deliveries")
        .select("delivery_id,employee_id,status")
        .eq("delivery_id", localRequest.delivery_id)
        .single();
      if (deliveryResult.error || !deliveryResult.data) throw new HttpError(404, "Delivery not found");
      delivery = deliveryResult.data;
    }

    const isAdmin = profile.role === "admin";
    const isOwner = localRequest.purpose === "checkout" && order.user_id === profile.userId;
    const isAssignedShipper = localRequest.purpose !== "checkout" && delivery?.employee_id === profile.userId;
    if (!isAdmin && !isOwner && !isAssignedShipper) throw new HttpError(403, "Forbidden");

    if (localRequest.status === "paid" || payment.data.status === "paid") {
      return json(request, {
        status: "paid",
        localStatus: localRequest.status,
        paymentStatus: payment.data.status,
        providerOrderCode: localRequest.provider_order_code,
        synced: false,
      });
    }
    if (localRequest.status !== "pending") {
      return json(request, {
        status: localRequest.status,
        localStatus: localRequest.status,
        paymentStatus: payment.data.status,
        providerOrderCode: localRequest.provider_order_code,
        synced: false,
      });
    }

    const response = await fetch(`https://api-merchant.payos.vn/v2/payment-requests/${localRequest.provider_order_code}`, {
      headers: {
        "x-client-id": Deno.env.get("PAYOS_CLIENT_ID")!,
        "x-api-key": Deno.env.get("PAYOS_API_KEY")!,
      },
    });
    const provider = await response.json() as PayosStatusResponse;
    if (!response.ok || provider.code !== "00" || !provider.data) {
      console.error("payOS status lookup failed", provider);
      throw new HttpError(502, "Could not read payOS payment status");
    }

    const providerStatus = String(provider.data.status ?? "").toUpperCase();
    if (isProviderPaid(provider.data, localRequest.amount)) {
      const confirmation = await admin.rpc("confirm_payos_request", {
        p_provider_order_code: localRequest.provider_order_code,
        p_amount: localRequest.amount,
        p_transaction_id: extractTransactionId(provider.data),
        p_payload: { source: "sync-payos-payment", provider },
      });
      if (confirmation.error) throw confirmation.error;
      return json(request, {
        status: "paid",
        providerStatus,
        providerOrderCode: localRequest.provider_order_code,
        synced: true,
      });
    }

    if (providerStatus === "CANCELLED") {
      const updated = await admin.from("payos_requests")
        .update({ status: "cancelled", provider_payload: provider, updated_at: new Date().toISOString() })
        .eq("request_id", localRequest.request_id)
        .eq("status", "pending");
      if (updated.error) throw updated.error;
    } else if (["EXPIRED", "FAILED"].includes(providerStatus)) {
      const updated = await admin.from("payos_requests")
        .update({ status: "failed", provider_payload: provider, updated_at: new Date().toISOString() })
        .eq("request_id", localRequest.request_id)
        .eq("status", "pending");
      if (updated.error) throw updated.error;
    }

    return json(request, {
      status: providerStatus.toLowerCase() || "pending",
      providerStatus,
      providerOrderCode: localRequest.provider_order_code,
      amountPaid: provider.data.amountPaid ?? 0,
      amountRemaining: provider.data.amountRemaining ?? null,
      synced: false,
    });
  } catch (error) {
    return handleError(request, error);
  }
});
