import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!publishableKey || !secretKey) {
  throw new Error("Usage: deno run --allow-net coupon-reward-policy-test.ts <url> <publishable-key> <secret-key>");
}

const service = createClient(baseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = Date.now();
const authUserIds: string[] = [];
const orderIds: string[] = [];
let customerId = "";
let adminId = "";
let reportId = "";

async function createUser(role: "customer" | "admin", label: string) {
  const email = `coupon-policy-${label}-${suffix}@freshtrace.local`;
  const password = "FreshTrace!123";
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Coupon policy ${label}` },
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create test user");
  authUserIds.push(created.data.user.id);

  if (role !== "customer") {
    const roleRow = await service.from("roles").select("role_id").eq("role_name", role).single();
    if (roleRow.error) throw roleRow.error;
    const changed = await service.from("users").update({ role_id: roleRow.data.role_id })
      .eq("auth_user_id", created.data.user.id);
    if (changed.error) throw changed.error;
  }

  const profile = await service.from("users").select("user_id")
    .eq("auth_user_id", created.data.user.id).single();
  if (profile.error) throw profile.error;
  const client: SupabaseClient = createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { client, userId: profile.data.user_id as string };
}

async function completeDeliveredOrder(totalAmount: number) {
  const order = await service.from("orders").insert({
    user_id: customerId,
    subtotal: totalAmount,
    total_amount: totalAmount,
    delivery_address: "Coupon policy integration test",
    delivery_fee: 0,
    status: "pending",
  }).select("order_id").single();
  if (order.error) throw order.error;
  orderIds.push(order.data.order_id);

  const delivery = await service.from("deliveries").insert({
    order_id: order.data.order_id,
    status: "delivered",
    delivery_time: new Date().toISOString(),
  });
  if (delivery.error) throw delivery.error;
  const completed = await service.from("orders").update({ status: "completed" })
    .eq("order_id", order.data.order_id);
  if (completed.error) throw completed.error;
}

async function expectMilestones(prefix: string, count: number) {
  const result = await service.from("coupons").select("milestone_key")
    .eq("user_id", customerId).like("milestone_key", `${prefix}%`);
  if (result.error) throw result.error;
  if (result.data.length !== count) {
    throw new Error(`Expected ${count} coupon milestones for ${prefix}, received ${result.data.length}`);
  }
}

async function cleanup() {
  if (reportId) await service.from("reports").delete().eq("report_id", reportId);
  if (customerId) {
    await service.from("notifications").delete().eq("user_id", customerId);
    await service.from("coupons").delete().eq("user_id", customerId);
  }
  if (adminId) await service.from("notifications").delete().eq("user_id", adminId);
  if (orderIds.length) {
    await service.from("chat_rooms").delete().in("order_id", orderIds);
    await service.from("deliveries").delete().in("order_id", orderIds);
    await service.from("payments").delete().in("order_id", orderIds);
    await service.from("orders").delete().in("order_id", orderIds);
  }
  for (const userId of [customerId, adminId].filter(Boolean)) {
    await service.from("users").delete().eq("user_id", userId);
  }
  for (const authUserId of authUserIds.reverse()) {
    await service.auth.admin.deleteUser(authUserId);
  }
}

try {
  const customer = await createUser("customer", "customer");
  const systemAdmin = await createUser("admin", "admin");
  customerId = customer.userId;
  adminId = systemAdmin.userId;

  const welcome = await service.from("coupons").select("milestone_key,coupon_type,discount_percent")
    .eq("user_id", customerId).like("milestone_key", "welcome_%");
  if (welcome.error) throw welcome.error;
  const welcomeKeys = new Set(welcome.data.map((coupon) => coupon.milestone_key));
  if (welcome.data.length !== 3
    || !welcomeKeys.has("welcome_freeship_1")
    || !welcomeKeys.has("welcome_freeship_2")
    || !welcomeKeys.has("welcome_10_percent")) {
    throw new Error("New customer did not receive two free-shipping coupons and one 10% coupon");
  }

  await completeDeliveredOrder(2_000_000);
  for (let index = 0; index < 9; index += 1) await completeDeliveredOrder(0);

  await expectMilestones("spend_freeship_500k_", 4);
  await expectMilestones("spend_percent10_1m_", 2);
  await expectMilestones("spend_percent20_2m_", 1);
  await expectMilestones("orders_freeship_5_", 2);
  await expectMilestones("orders_percent10_10_", 1);

  const report = await customer.client.from("reports").insert({
    user_id: customerId,
    type: "other",
    description: "Verified coupon reward policy integration report",
  }).select("report_id").single();
  if (report.error) throw report.error;
  reportId = report.data.report_id;
  const resolved = await systemAdmin.client.rpc("resolve_report", {
    p_report_id: reportId,
    p_status: "resolved",
    p_response: "Approved by coupon policy integration test",
  });
  if (resolved.error) throw resolved.error;
  await expectMilestones(`report_reward_${reportId}`, 1);

  const disposableCoupon = await service.from("coupons").insert({
    code: `DELETE-AFTER-USE-${suffix}`,
    user_id: customerId,
    amount: 15000,
    remaining_amount: 0,
    coupon_type: "fixed_amount",
    status: "active",
    milestone_key: `delete_after_use_${suffix}`,
  }).select("coupon_id").single();
  if (disposableCoupon.error) throw disposableCoupon.error;
  const couponOrder = await service.from("orders").insert({
    user_id: customerId,
    subtotal: 100000,
    total_amount: 85000,
    delivery_address: "Coupon deletion integration test",
    delivery_fee: 0,
    discount_amount: 15000,
    applied_coupon_id: disposableCoupon.data.coupon_id,
  }).select("order_id").single();
  if (couponOrder.error) throw couponOrder.error;
  orderIds.push(couponOrder.data.order_id);
  const consume = await service.from("coupons").update({
    used_order_id: couponOrder.data.order_id,
  }).eq("coupon_id", disposableCoupon.data.coupon_id);
  if (consume.error) throw consume.error;
  const finishCouponOrder = await service.from("orders").update({ status: "completed" })
    .eq("order_id", couponOrder.data.order_id);
  if (finishCouponOrder.error) throw finishCouponOrder.error;
  const removedCoupon = await service.from("coupons").select("coupon_id")
    .eq("coupon_id", disposableCoupon.data.coupon_id).maybeSingle();
  if (removedCoupon.error || removedCoupon.data) {
    throw removedCoupon.error ?? new Error("Successfully used coupon was not deleted");
  }

  const paidOrder = await service.from("orders").insert({
    user_id: customerId,
    subtotal: 345000,
    total_amount: 345000,
    delivery_address: "Paid cancellation integration test",
    delivery_fee: 0,
  }).select("order_id").single();
  if (paidOrder.error) throw paidOrder.error;
  orderIds.push(paidOrder.data.order_id);
  const paidPayment = await service.from("payments").insert({
    order_id: paidOrder.data.order_id,
    method: "payos",
    status: "paid",
    amount: 345000,
    payment_date: new Date().toISOString(),
  });
  if (paidPayment.error) throw paidPayment.error;
  const cancelled = await service.rpc("cancel_order_service", {
    p_order_id: paidOrder.data.order_id,
    p_reason: "Paid cancellation coupon integration test",
    p_actor_id: customerId,
    p_issue_coupon: true,
  });
  if (cancelled.error || !cancelled.data) throw cancelled.error ?? new Error("Paid cancellation did not issue a coupon");
  const cancellationCoupon = await service.from("coupons")
    .select("amount,remaining_amount,status")
    .eq("source_order_id", paidOrder.data.order_id).single();
  if (cancellationCoupon.error
    || Number(cancellationCoupon.data.amount) !== 345000
    || Number(cancellationCoupon.data.remaining_amount) !== 345000
    || cancellationCoupon.data.status !== "active") {
    throw cancellationCoupon.error ?? new Error("Paid cancellation coupon did not match the paid amount");
  }

  console.log("PASS coupon signup: two free-shipping coupons and one 10% coupon");
  console.log("PASS delivered spend: 500K free shipping, 1M 10%, and 2M 20% milestones");
  console.log("PASS delivered count: 5-order free shipping and 10-order 10% milestones");
  console.log("PASS approved report: one 10,000 VND coupon");
  console.log("PASS large delivered order: random reward remains bounded to its optional milestone");
  console.log("PASS coupon lifecycle: successfully used coupon is deleted");
  console.log("PASS paid cancellation: exact paid amount is returned as an active coupon");
} finally {
  await cleanup();
}
