import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!publishableKey || !secretKey) {
  throw new Error("Usage: deno run --allow-net backend-integration-test.ts <url> <publishable-key> <secret-key>");
}

const admin = createClient(baseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicClient = createClient(baseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = Date.now();

type Role = "admin" | "manager" | "employee" | "customer";
type TestUser = { client: SupabaseClient; userId: string; authUserId: string; email: string };

async function createTestUser(role: Role, label: string): Promise<TestUser> {
  const email = `${label}.${suffix}@freshtrace.local`;
  const password = "FreshTrace!123";
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `${label} integration` },
  });
  if (createError || !created.user) throw createError ?? new Error("Auth user creation failed");

  const { data: roleRow, error: roleError } = await admin.from("roles")
    .select("role_id").eq("role_name", role).single();
  if (roleError) throw roleError;
  const { data: profile, error: profileError } = await admin.from("users")
    .update({ role_id: roleRow.role_id })
    .eq("auth_user_id", created.user.id)
    .select("user_id").single();
  if (profileError) throw profileError;

  const client = createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return { client, userId: profile.user_id, authUserId: created.user.id, email };
}

async function expectFailure(label: string, operation: () => PromiseLike<{ error: unknown }>) {
  const result = await operation();
  if (!result.error) throw new Error(`Expected failure: ${label}`);
}

const customer = await createTestUser("customer", "customer");
const otherCustomer = await createTestUser("customer", "other-customer");
const manager = await createTestUser("manager", "manager");
const employee = await createTestUser("employee", "employee");
const otherEmployee = await createTestUser("employee", "other-employee");
const systemAdmin = await createTestUser("admin", "admin");

const { data: pendingSupplier, error: supplierCreateError } = await manager.client.from("suppliers").insert({
  name: `Manager supplier ${suffix}`,
  certificate: "TEST-CERTIFICATE",
  description: "Created by backend integration test",
}).select("supplier_id,status").single();
if (supplierCreateError || pendingSupplier.status !== "pending") {
  throw supplierCreateError ?? new Error("Manager could not create a pending supplier");
}
await expectFailure("manager cannot approve supplier", () =>
  manager.client.from("suppliers").update({ status: "approved" }).eq("supplier_id", pendingSupplier.supplier_id));
const { error: supplierApproveError } = await systemAdmin.client.rpc("approve_supplier", {
  p_supplier_id: pendingSupplier.supplier_id,
  p_status: "approved",
  p_response: "Approved by integration test",
});
if (supplierApproveError) throw supplierApproveError;

const { data: catalog, error: catalogError } = await publicClient.rpc("search_products", {
  p_query: "spinach",
  p_limit: 10,
});
if (catalogError || catalog.length !== 1 || !catalog[0].batch_id) {
  throw catalogError ?? new Error("Public catalog search failed");
}

const { data: cart, error: cartError } = await customer.client.from("carts")
  .select("cart_id").single();
if (cartError) throw cartError;

await expectFailure("mismatched product and batch in cart", () =>
  customer.client.from("cart_items").insert({
    cart_id: cart.cart_id,
    product_id: "30000000-0000-0000-0000-000000000002",
    batch_id: "40000000-0000-0000-0000-000000000001",
    quantity: 1,
  }));

const { error: cartItemError } = await customer.client.from("cart_items").insert({
  cart_id: cart.cart_id,
  product_id: "30000000-0000-0000-0000-000000000001",
  batch_id: "40000000-0000-0000-0000-000000000001",
  quantity: 2,
});
if (cartItemError) throw cartItemError;

const { data: orderId, error: checkoutError } = await customer.client.rpc("checkout_cart", {
  p_delivery_address: "123 Nguyen Hue, District 1",
  p_payment_method: "cod",
  p_delivery_fee: 20000,
  p_note: "Backend integration test",
});
if (checkoutError) throw checkoutError;

const { error: confirmError } = await manager.client.rpc("confirm_order", { p_order_id: orderId });
if (confirmError) throw confirmError;
const { error: preparingError } = await manager.client.rpc("mark_order_preparing", { p_order_id: orderId });
if (preparingError) throw preparingError;
const { data: deliveryId, error: assignError } = await manager.client.rpc("assign_delivery", {
  p_order_id: orderId,
  p_employee_id: employee.userId,
});
if (assignError) throw assignError;

const { data: customerContacts, error: customerContactsError } = await customer.client.rpc("list_chat_contacts");
if (customerContactsError
  || !customerContacts.some((contact: Record<string, unknown>) =>
    contact.user_id === employee.userId && contact.order_id === orderId && contact.room_type === "customer_shipper")
  || !customerContacts.some((contact: Record<string, unknown>) =>
    contact.user_id === manager.userId && contact.room_type === "customer_manager")) {
  throw customerContactsError ?? new Error("Eligible customer chat contacts were not returned");
}

await expectFailure("pickup before batch verification", () =>
  employee.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: "picked_up",
    p_note: null,
    p_proof_image_url: null,
  }));

await expectFailure("chat with unassigned shipper", () =>
  customer.client.rpc("create_chat_room", {
    p_type: "customer_shipper",
    p_other_user_id: otherEmployee.userId,
    p_order_id: orderId,
    p_product_id: null,
  }));

const { data: verification, error: verifyError } = await employee.client.rpc("verify_delivery_batch", {
  p_delivery_id: deliveryId,
  p_batch_id: "40000000-0000-0000-0000-000000000001",
});
if (verifyError || !verification.matches) throw verifyError ?? new Error("Batch verification failed");

for (const status of ["picked_up", "delivering"] as const) {
  const { error } = await employee.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: status,
    p_note: `Integration test: ${status}`,
    p_proof_image_url: null,
  });
  if (error) throw error;
}
const shipperDeliveryQuery = await employee.client.from("deliveries")
  .select("delivery_id,status,proof_image_url,delivery_batch_checks(batch_id,matched,checked_at),delivery_payment_collections(method,status,remittance_status),orders(order_id,order_code,delivery_address,users(name,phone),payments(method,status),order_items(order_item_id,product_name,quantity,batches(batch_id,batch_code)))")
  .eq("delivery_id", deliveryId)
  .single();
if (shipperDeliveryQuery.error
  || shipperDeliveryQuery.data.status !== "delivering"
  || !shipperDeliveryQuery.data.orders) {
  throw shipperDeliveryQuery.error ?? new Error("Shipper delivery page query failed while delivery is delivering");
}
const { error: collectionError } = await employee.client.rpc("record_delivery_collection", {
  p_delivery_id: deliveryId,
  p_method: "cash",
  p_proof_url: null,
});
if (collectionError) throw collectionError;
await expectFailure("cash delivery requires payOS remittance", () =>
  employee.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: "delivered",
    p_note: "Must fail before cash remittance",
    p_proof_image_url: null,
  }));
const { error: remittanceError } = await admin.from("delivery_payment_collections")
  .update({ remittance_status: "paid", remitted_at: new Date().toISOString() })
  .eq("delivery_id", deliveryId);
if (remittanceError) throw remittanceError;
const { error: deliveredError } = await employee.client.rpc("update_delivery_status", {
  p_delivery_id: deliveryId,
  p_status: "delivered",
  p_note: "Delivered in integration test without proof upload",
  p_proof_image_url: null,
});
if (deliveredError) throw deliveredError;

const { data: order, error: orderError } = await customer.client.from("orders")
  .select("status,payments(status)").eq("order_id", orderId).single();
if (orderError || order.status !== "completed") throw orderError ?? new Error("Order did not complete");
const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
if (payment.status !== "paid") throw new Error("COD payment was not settled");
const roomSummary = await customer.client.rpc("list_my_chat_rooms");
if (roomSummary.error || !roomSummary.data?.some((room: { order_id: string; peer_name: string }) =>
  room.order_id === orderId && room.peer_name
)) throw roomSummary.error ?? new Error("Automatic order conversations were not listed with peer details");

const { data: roomId, error: roomError } = await customer.client.rpc("create_chat_room", {
  p_type: "customer_shipper",
  p_other_user_id: employee.userId,
  p_order_id: orderId,
  p_product_id: null,
});
if (roomError) throw roomError;
const { data: chatMessage, error: messageError } = await customer.client.from("chat_messages").insert({
  room_id: roomId,
  sender_id: customer.userId,
  message: "Integration test message",
}).select("message_id").single();
if (messageError) throw messageError;
const { error: attachmentError } = await employee.client.from("chat_messages").insert({
  room_id: roomId,
  sender_id: employee.userId,
  message: null,
  attachment_url: "https://example.com/delivery-note.pdf",
  attachment_name: "delivery-note.pdf",
  attachment_type: "application/pdf",
  attachment_size: 2048,
});
if (attachmentError) throw attachmentError;
const { error: reactionError } = await employee.client.from("chat_message_reactions").insert({
  message_id: chatMessage.message_id,
  user_id: employee.userId,
  reaction: "like",
});
if (reactionError) throw reactionError;
const changedReaction = await employee.client.from("chat_message_reactions").upsert({
  message_id: chatMessage.message_id,
  user_id: employee.userId,
  reaction: "love",
}, { onConflict: "message_id,user_id" });
if (changedReaction.error) throw changedReaction.error;
const { count: reactionCount, error: reactionReadError } = await customer.client
  .from("chat_message_reactions").select("*", { count: "exact", head: true })
  .eq("message_id", chatMessage.message_id);
if (reactionReadError || reactionCount !== 1) {
  throw reactionReadError ?? new Error("Chat reaction was not visible to room members");
}
const messageCards = await customer.client.from("chat_messages")
  .select("message_id,users(name,avatar_url,email,phone,roles(role_name)),shared_product:products!chat_messages_shared_product_id_fkey(product_id,name,image_url,unit),shared_order:orders!chat_messages_shared_order_id_fkey(order_id,order_code,total_amount,status)")
  .eq("message_id", chatMessage.message_id).single();
if (messageCards.error || !messageCards.data.users) {
  throw messageCards.error ?? new Error("Chat sender profile relation was not available");
}
const { data: outsiderReactions, error: outsiderReactionError } = await otherCustomer.client
  .from("chat_message_reactions").select("reaction_id")
  .eq("message_id", chatMessage.message_id);
if (outsiderReactionError || outsiderReactions.length !== 0) {
  throw outsiderReactionError ?? new Error("Chat reactions leaked outside the room");
}
const { count: messageNotificationCount, error: notificationError } = await employee.client
  .from("notifications").select("*", { count: "exact", head: true })
  .eq("type", "chat_message");
if (notificationError || !messageNotificationCount) {
  throw notificationError ?? new Error("Chat notification was not created");
}

const { data: inventoryBefore, error: inventoryReadError } = await manager.client.from("inventory")
  .select("quantity_available").eq("batch_id", "40000000-0000-0000-0000-000000000001").single();
if (inventoryReadError) throw inventoryReadError;
const { error: directInventoryError } = await manager.client.from("inventory")
  .update({ quantity_available: 999 })
  .eq("batch_id", "40000000-0000-0000-0000-000000000001");
if (directInventoryError) throw directInventoryError;
const { data: inventoryAfterDirect, error: inventoryAfterDirectError } = await manager.client
  .from("inventory").select("quantity_available")
  .eq("batch_id", "40000000-0000-0000-0000-000000000001").single();
if (inventoryAfterDirectError || inventoryAfterDirect.quantity_available !== inventoryBefore.quantity_available) {
  throw inventoryAfterDirectError ?? new Error("Direct inventory update bypassed RPC enforcement");
}
const { error: adjustError } = await manager.client.rpc("adjust_inventory", {
  p_batch_id: "40000000-0000-0000-0000-000000000001",
  p_new_quantity: inventoryBefore.quantity_available + 1,
  p_note: "Integration test adjustment",
});
if (adjustError) throw adjustError;

await expectFailure("Fresh Rescue on batch outside expiry window", () =>
  manager.client.from("fresh_rescue_deals").insert({
    batch_id: "40000000-0000-0000-0000-000000000001",
    title: "Invalid rescue",
    original_price: 25000,
    rescue_price: 20000,
    end_at: new Date(Date.now() + 86400000).toISOString(),
    created_by: manager.userId,
  }));
const existingRescue = await manager.client.from("fresh_rescue_deals").select("deal_id")
  .eq("batch_id", "40000000-0000-0000-0000-000000000002").eq("status", "active").maybeSingle();
if (existingRescue.error) throw existingRescue.error;
if (!existingRescue.data) {
  const { error: rescueError } = await manager.client.from("fresh_rescue_deals").insert({
    batch_id: "40000000-0000-0000-0000-000000000002",
    title: "Valid rescue",
    original_price: 32000,
    rescue_price: 25000,
    end_at: new Date(Date.now() + 86400000).toISOString(),
    created_by: manager.userId,
  });
  if (rescueError) throw rescueError;
}

const { error: secondCartItemError } = await customer.client.from("cart_items").insert({
  cart_id: cart.cart_id,
  product_id: "30000000-0000-0000-0000-000000000001",
  batch_id: "40000000-0000-0000-0000-000000000001",
  quantity: 1,
});
if (secondCartItemError) throw secondCartItemError;
const { data: cancelledOrderId, error: secondCheckoutError } = await customer.client.rpc("checkout_cart", {
  p_delivery_address: "123 Main Street",
  p_payment_method: "cod",
  p_delivery_fee: 0,
  p_note: "Cancellation integration test",
});
if (secondCheckoutError) throw secondCheckoutError;
const { error: cancellationError } = await customer.client.rpc("cancel_order", {
  p_order_id: cancelledOrderId,
  p_reason: "Integration test cancellation",
});
if (cancellationError) throw cancellationError;
const { data: cancelledOrder, error: cancelledOrderError } = await customer.client.from("orders")
  .select("status,payments(status)").eq("order_id", cancelledOrderId).single();
if (cancelledOrderError || cancelledOrder.status !== "cancelled") {
  throw cancelledOrderError ?? new Error("COD cancellation did not complete");
}

const { error: paidCartItemError } = await customer.client.from("cart_items").insert({
  cart_id: cart.cart_id,
  product_id: "30000000-0000-0000-0000-000000000001",
  batch_id: "40000000-0000-0000-0000-000000000001",
  quantity: 1,
});
if (paidCartItemError) throw paidCartItemError;
const { data: paidPendingOrderId, error: paidCheckoutError } = await customer.client.rpc("checkout_cart", {
  p_delivery_address: "123 Main Street",
  p_payment_method: "payos",
  p_delivery_fee: 0,
  p_note: "Paid pending cancellation coupon test",
});
if (paidCheckoutError) throw paidCheckoutError;
const { error: markPaidError } = await admin.from("payments")
  .update({ status: "paid", payment_date: new Date().toISOString() })
  .eq("order_id", paidPendingOrderId);
if (markPaidError) throw markPaidError;
const { data: couponCode, error: paidCancelError } = await admin.rpc("cancel_order_service", {
  p_order_id: paidPendingOrderId,
  p_reason: "Integration test paid cancellation",
  p_actor_id: customer.userId,
  p_issue_coupon: true,
});
if (paidCancelError || !couponCode) throw paidCancelError ?? new Error("Paid pending cancellation did not issue a coupon");
const { data: coupon, error: couponError } = await customer.client.from("coupons")
  .select("code,amount,remaining_amount,status").eq("source_order_id", paidPendingOrderId).single();
if (couponError || coupon.code !== couponCode || coupon.amount !== coupon.remaining_amount || coupon.status !== "active") {
  throw couponError ?? new Error("Cancellation coupon value or status is invalid");
}

const { error: recoveryCartError } = await customer.client.from("cart_items").insert({
  cart_id: cart.cart_id,
  product_id: "30000000-0000-0000-0000-000000000001",
  batch_id: "40000000-0000-0000-0000-000000000001",
  quantity: 1,
});
if (recoveryCartError) throw recoveryCartError;
const { data: recoveryOrderId, error: recoveryCheckoutError } = await customer.client.rpc("checkout_cart", {
  p_delivery_address: "123 Main Street",
  p_payment_method: "cod",
  p_delivery_fee: 0,
  p_note: "Failed delivery recovery test",
});
if (recoveryCheckoutError) throw recoveryCheckoutError;
const { error: recoveryConfirmError } = await manager.client.rpc("confirm_order", {
  p_order_id: recoveryOrderId,
});
if (recoveryConfirmError) throw recoveryConfirmError;
const { data: recoveryDeliveryId, error: recoveryAssignError } = await manager.client.rpc("assign_delivery", {
  p_order_id: recoveryOrderId,
  p_employee_id: employee.userId,
});
if (recoveryAssignError) throw recoveryAssignError;
const { error: failDeliveryError } = await employee.client.rpc("update_delivery_status", {
  p_delivery_id: recoveryDeliveryId,
  p_status: "failed",
  p_note: "Recipient unavailable",
  p_proof_image_url: null,
});
if (failDeliveryError) throw failDeliveryError;
const { data: recoveryOrder, error: recoveryOrderError } = await manager.client.from("orders")
  .select("status").eq("order_id", recoveryOrderId).single();
if (recoveryOrderError || recoveryOrder.status !== "confirmed") {
  throw recoveryOrderError ?? new Error("Failed delivery did not return order to confirmed");
}
const { error: reassignmentError } = await manager.client.rpc("assign_delivery", {
  p_order_id: recoveryOrderId,
  p_employee_id: otherEmployee.userId,
});
if (reassignmentError) throw reassignmentError;

const { data: report, error: reportError } = await customer.client.from("reports").insert({
  user_id: customer.userId,
  order_id: orderId,
  type: "delivery",
  description: "Integration test report",
}).select("report_id").single();
if (reportError) throw reportError;
await expectFailure("report linked to another customer's order", () =>
  otherCustomer.client.from("reports").insert({
    user_id: otherCustomer.userId,
    order_id: orderId,
    type: "order",
    description: "Invalid cross-user report",
  }));
const { error: resolveError } = await systemAdmin.client.rpc("resolve_report", {
  p_report_id: report.report_id,
  p_status: "resolved",
  p_response: "Resolved by integration test",
});
if (resolveError) throw resolveError;

const { error: banError } = await admin.from("users").update({ status: "banned" })
  .eq("user_id", customer.userId);
if (banError) throw banError;
const { data: blockedCarts, error: blockedCartError } = await customer.client.from("carts")
  .select("cart_id");
if (blockedCartError || blockedCarts.length !== 0) {
  throw blockedCartError ?? new Error("Banned customer retained cart access");
}

console.log(JSON.stringify({
  ok: true,
  orderId,
  deliveryId,
  roomId,
  checks: [
    "auth profile and cart trigger",
    "manager supplier submission and admin approval",
    "public catalog search RPC",
    "cart product/batch invariant",
    "checkout, COD settlement, and cash remittance gate",
    "confirmed to preparing order transition",
    "delivery batch verification gate",
    "automatic order chat and peer summary",
    "relationship-based chat contact discovery",
    "chat relationship authorization",
    "chat notification trigger",
    "chat attachments and single-reaction RLS",
    "inventory RPC enforcement",
    "Fresh Rescue eligibility",
    "COD cancellation and inventory release",
    "paid pending cancellation coupon",
    "failed delivery reassignment",
    "report resolution",
    "report order ownership invariant",
    "banned-user access revocation",
  ],
}, null, 2));
