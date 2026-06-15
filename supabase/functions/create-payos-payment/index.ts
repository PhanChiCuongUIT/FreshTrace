import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";
import { hmacSha256, sortedQuery } from "../_shared/signature.ts";
import QRCode from "npm:qrcode@1.5.4";

type Purpose = "checkout" | "customer_cod" | "shipper_remittance";
type Body = { orderId: string; purpose?: Purpose };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request);
    const { orderId, purpose = "checkout" } = await readJson<Body>(request);
    if (!orderId) throw new HttpError(400, "orderId is required");
    if (!["checkout", "customer_cod", "shipper_remittance"].includes(purpose)) {
      throw new HttpError(400, "Invalid payment purpose");
    }

    const admin = adminClient();
    const { data: order, error } = await admin.from("orders")
      .select("order_id,order_code,total_amount,status,user_id,users!inner(name,email,phone),payments!inner(payment_id,method,status,amount),deliveries(delivery_id,employee_id,status)")
      .eq("order_id", orderId).single();
    if (error || !order) throw new HttpError(404, "Order not found");
    const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
    const delivery = Array.isArray(order.deliveries) ? order.deliveries[0] : order.deliveries;
    if (!payment) throw new HttpError(404, "Payment record not found");

    if (purpose === "checkout") {
      if (profile.role !== "customer" || order.user_id !== profile.userId) throw new HttpError(403, "Forbidden");
      if (payment.method !== "payos") throw new HttpError(409, "Order does not use payOS checkout");
      if (order.status !== "pending" || payment.status !== "pending") {
        throw new HttpError(409, "This checkout is no longer awaiting payment");
      }
    } else if (purpose === "customer_cod") {
      if (profile.role !== "employee" || delivery?.employee_id !== profile.userId) {
        throw new HttpError(403, "Only the assigned Shipper can create the COD QR");
      }
      if (payment.method !== "cod" || payment.status !== "pending" || delivery.status !== "delivering") {
        throw new HttpError(409, "COD QR is only available while delivering");
      }
    } else {
      if (profile.role !== "employee" || delivery?.employee_id !== profile.userId) throw new HttpError(403, "Forbidden");
      const collection = await admin.from("delivery_payment_collections")
        .select("collection_id,method,remittance_status").eq("delivery_id", delivery.delivery_id).maybeSingle();
      if (collection.error || !collection.data || collection.data.method !== "cash") {
        throw new HttpError(409, "Record a cash collection before creating a remittance");
      }
      if (collection.data.remittance_status !== "pending" || payment.status !== "pending") {
        throw new HttpError(409, "Cash was already remitted or the payment is closed");
      }
    }

    if (payment.status === "paid" && purpose !== "shipper_remittance") {
      throw new HttpError(409, "Order is already paid");
    }
    const existing = await admin.from("payos_requests")
      .select("checkout_url,qr_code,provider_order_code,status")
      .eq("payment_id", payment.payment_id).eq("purpose", purpose).eq("status", "pending").maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.checkout_url) {
      if (purpose === "checkout") {
        const repaired = await admin.from("payments").update({
          provider_order_code: existing.data.provider_order_code,
          payment_url: existing.data.checkout_url,
          qr_code: existing.data.qr_code,
        }).eq("payment_id", payment.payment_id).select("payment_id").single();
        if (repaired.error) throw repaired.error;
      }
      return json(request, {
        ...existing.data,
        providerOrderCode: existing.data.provider_order_code,
        checkoutUrl: existing.data.checkout_url,
        qrCode: existing.data.qr_code,
        qrDataUrl: existing.data.qr_code
          ? await QRCode.toDataURL(existing.data.qr_code, { width: 420, margin: 2 })
          : null,
        reused: true,
      });
    }

    const collection = purpose === "shipper_remittance"
      ? await admin.from("delivery_payment_collections").select("collection_id").eq("delivery_id", delivery!.delivery_id).single()
      : null;
    const providerOrderCode = Date.now() * 100 + crypto.getRandomValues(new Uint8Array(1))[0];
    const amount = Math.round(Number(payment.amount));
    const description = `${purpose === "shipper_remittance" ? "FTR" : purpose === "customer_cod" ? "FTC" : "FT"}${order.order_code}`.slice(0, 9);
    const payload: Record<string, unknown> = {
      orderCode: providerOrderCode,
      amount,
      description,
      cancelUrl: Deno.env.get("PAYOS_CANCEL_URL")!,
      returnUrl: Deno.env.get("PAYOS_RETURN_URL")!,
    };
    payload.signature = await hmacSha256(sortedQuery({
      amount: payload.amount, cancelUrl: payload.cancelUrl, description: payload.description,
      orderCode: payload.orderCode, returnUrl: payload.returnUrl,
    }), Deno.env.get("PAYOS_CHECKSUM_KEY")!);

    const response = await fetch("https://api-merchant.payos.vn/v2/payment-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": Deno.env.get("PAYOS_CLIENT_ID")!,
        "x-api-key": Deno.env.get("PAYOS_API_KEY")!,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || result.code !== "00" || !result.data?.checkoutUrl) {
      console.error("payOS create payment failed", result);
      throw new HttpError(502, "Could not create payOS payment link");
    }

    const inserted = await admin.from("payos_requests").insert({
      payment_id: payment.payment_id,
      delivery_id: delivery?.delivery_id ?? null,
      collection_id: collection?.data?.collection_id ?? null,
      purpose,
      requested_by: profile.userId,
      provider_order_code: providerOrderCode,
      amount,
      checkout_url: result.data.checkoutUrl,
      qr_code: result.data.qrCode,
      transaction_id: result.data.paymentLinkId,
      provider_payload: result,
    }).select("request_id").single();
    if (inserted.error) throw inserted.error;
    if (purpose === "checkout") {
      const paymentUpdate = await admin.from("payments").update({
        provider_order_code: providerOrderCode,
        payment_url: result.data.checkoutUrl,
        qr_code: result.data.qrCode,
      }).eq("payment_id", payment.payment_id).select("payment_id").single();
      if (paymentUpdate.error) throw paymentUpdate.error;
    }
    return json(request, {
      checkoutUrl: result.data.checkoutUrl,
      qrCode: result.data.qrCode,
      qrDataUrl: result.data.qrCode
        ? await QRCode.toDataURL(result.data.qrCode, { width: 420, margin: 2 })
        : null,
      paymentLinkId: result.data.paymentLinkId,
      providerOrderCode,
      purpose,
    }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
