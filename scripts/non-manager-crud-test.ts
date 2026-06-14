import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!publishableKey || !secretKey) {
  throw new Error("Usage: non-manager-crud-test.ts <url> <publishable-key> <secret-key>");
}

const service = createClient(baseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = Date.now();
const authIds: string[] = [];
const userIds: string[] = [];
const orderIds: string[] = [];
const roomIds: string[] = [];
const reportIds: string[] = [];
let supplierId = "";

async function expectFailure(label: string, operation: () => PromiseLike<{ error: unknown }>) {
  const result = await operation();
  if (!result.error) throw new Error(`Expected failure: ${label}`);
}

async function createUser(role: "customer" | "manager" | "admin", label: string) {
  const email = `non-manager-crud-${label}-${suffix}@freshtrace.local`;
  const password = "FreshTrace!123";
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `CRUD ${label}` },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${label}`);
  }
  authIds.push(created.data.user.id);

  const roleRow = await service.from("roles").select("role_id").eq("role_name", role).single();
  if (roleRow.error) throw roleRow.error;
  const profile = await service.from("users").update({ role_id: roleRow.data.role_id })
    .eq("auth_user_id", created.data.user.id)
    .select("user_id")
    .single();
  if (profile.error) throw profile.error;
  userIds.push(profile.data.user_id);

  const client: SupabaseClient = createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { client, userId: profile.data.user_id as string };
}

async function cleanup() {
  if (roomIds.length) await service.from("chat_rooms").delete().in("room_id", roomIds);
  if (reportIds.length) await service.from("reports").delete().in("report_id", reportIds);
  if (orderIds.length) {
    await service.from("order_manager_assignments").delete().in("order_id", orderIds);
    await service.from("orders").delete().in("order_id", orderIds);
  }
  if (supplierId) await service.from("suppliers").delete().eq("supplier_id", supplierId);
  if (userIds.length) await service.from("notifications").delete().in("user_id", userIds);
  for (const authId of authIds.reverse()) await service.auth.admin.deleteUser(authId);
}

try {
  const customer = await createUser("customer", "customer");
  const otherCustomer = await createUser("customer", "other-customer");
  const manager = await createUser("manager", "manager");
  const admin = await createUser("admin", "admin");

  const catalog = await service.rpc("search_products", { p_limit: 5, p_offset: 0 });
  if (catalog.error || catalog.data.length < 2) {
    throw catalog.error ?? new Error("At least two sellable products are required for CRUD tests");
  }
  const first = catalog.data[0] as { product_id: string; batch_id: string };
  const second = catalog.data[1] as { product_id: string; batch_id: string };

  const profileUpdate = await customer.client.from("users")
    .update({ name: "CRUD customer updated", status: "banned" })
    .eq("user_id", customer.userId)
    .select("name,status")
    .single();
  if (profileUpdate.error || profileUpdate.data.name !== "CRUD customer updated"
    || profileUpdate.data.status !== "active") {
    throw profileUpdate.error ?? new Error("Profile update did not protect privileged fields");
  }
  const directAdminProfileUpdate = await admin.client.from("users")
    .update({ name: "Admin bypass attempt", status: "inactive" })
    .eq("user_id", customer.userId)
    .select("user_id");
  if (directAdminProfileUpdate.error || directAdminProfileUpdate.data.length !== 0) {
    throw directAdminProfileUpdate.error ?? new Error("Admin bypassed the user governance endpoint");
  }
  const profileAfterAdminAttempt = await service.from("users")
    .select("name,status")
    .eq("user_id", customer.userId)
    .single();
  if (profileAfterAdminAttempt.error
    || profileAfterAdminAttempt.data.name !== "CRUD customer updated"
    || profileAfterAdminAttempt.data.status !== "active") {
    throw profileAfterAdminAttempt.error ?? new Error("Direct Admin profile mutation changed the user");
  }
  const directAdminDelete = await admin.client.from("users")
    .delete()
    .eq("user_id", customer.userId)
    .select("user_id");
  if (directAdminDelete.error || directAdminDelete.data.length !== 0) {
    throw directAdminDelete.error ?? new Error("Admin directly deleted an application user");
  }

  const cart = await customer.client.from("carts").select("cart_id").single();
  if (cart.error) throw cart.error;
  const rootCartDelete = await customer.client.from("carts")
    .delete()
    .eq("cart_id", cart.data.cart_id)
    .select("cart_id");
  if (rootCartDelete.error || rootCartDelete.data.length !== 0) {
    throw rootCartDelete.error ?? new Error("Customer deleted the root cart");
  }
  const cartAfterDeleteAttempt = await service.from("carts")
    .select("cart_id")
    .eq("cart_id", cart.data.cart_id)
    .single();
  if (cartAfterDeleteAttempt.error) {
    throw cartAfterDeleteAttempt.error;
  }
  const cartItem = await customer.client.from("cart_items").insert({
    cart_id: cart.data.cart_id,
    product_id: first.product_id,
    batch_id: first.batch_id,
    quantity: 1,
  }).select("cart_item_id").single();
  if (cartItem.error) throw cartItem.error;
  const cartUpdated = await customer.client.from("cart_items").update({ quantity: 2 })
    .eq("cart_item_id", cartItem.data.cart_item_id).select("quantity").single();
  if (cartUpdated.error || cartUpdated.data.quantity !== 2) {
    throw cartUpdated.error ?? new Error("Cart quantity was not updated");
  }
  const cartDeleted = await customer.client.from("cart_items").delete()
    .eq("cart_item_id", cartItem.data.cart_item_id).select("cart_item_id").single();
  if (cartDeleted.error) throw cartDeleted.error;

  const notification = await service.from("notifications").insert({
    user_id: customer.userId,
    title: "Original notification",
    content: "Read-state CRUD verification",
    type: "crud_test",
  }).select("notification_id").single();
  if (notification.error) throw notification.error;
  const notificationUpdate = await customer.client.from("notifications")
    .update({ title: "Tampered notification", is_read: true })
    .eq("notification_id", notification.data.notification_id)
    .select("title,is_read")
    .single();
  if (notificationUpdate.error || notificationUpdate.data.title !== "Original notification"
    || !notificationUpdate.data.is_read) {
    throw notificationUpdate.error ?? new Error("Notification update changed protected content");
  }

  const order = await service.from("orders").insert({
    user_id: customer.userId,
    status: "completed",
    subtotal: 100000,
    total_amount: 100000,
    delivery_address: "Non-manager CRUD integration test",
    delivery_fee: 0,
  }).select("order_id").single();
  if (order.error) throw order.error;
  orderIds.push(order.data.order_id);
  const orderItem = await service.from("order_items").insert({
    order_id: order.data.order_id,
    product_id: first.product_id,
    batch_id: first.batch_id,
    product_name: "CRUD product",
    unit: "item",
    quantity: 1,
    price: 100000,
  });
  if (orderItem.error) throw orderItem.error;
  const assignment = await service.from("order_manager_assignments").upsert({
    order_id: order.data.order_id,
    manager_id: manager.userId,
  }, { onConflict: "order_id" });
  if (assignment.error) throw assignment.error;

  const review = await customer.client.from("reviews").insert({
    user_id: customer.userId,
    order_id: order.data.order_id,
    product_id: first.product_id,
    rating: 5,
    comment: "  Fresh and traceable  ",
  }).select("review_id,product_id,comment").single();
  if (review.error || review.data.comment !== "Fresh and traceable") {
    throw review.error ?? new Error("Review was not created and normalized");
  }
  const protectedReview = await customer.client.from("reviews")
    .update({ product_id: second.product_id, rating: 4 })
    .eq("review_id", review.data.review_id)
    .select("product_id,rating")
    .single();
  if (protectedReview.error || protectedReview.data.product_id !== first.product_id
    || protectedReview.data.rating !== 4) {
    throw protectedReview.error ?? new Error("Review update changed immutable ownership fields");
  }

  await expectFailure("short report description", () =>
    customer.client.from("reports").insert({
      user_id: customer.userId,
      order_id: order.data.order_id,
      type: "order_issue",
      description: "Too short",
    })
  );
  const report = await customer.client.from("reports").insert({
    user_id: customer.userId,
    order_id: order.data.order_id,
    type: "order_issue",
    description: "A valid report used to verify final status protection",
  }).select("report_id").single();
  if (report.error) throw report.error;
  reportIds.push(report.data.report_id);
  const directReportUpdate = await admin.client.from("reports")
    .update({
      status: "resolved",
      response: "Direct update must not run report side effects",
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("report_id", report.data.report_id)
    .select("report_id");
  if (directReportUpdate.error || directReportUpdate.data.length !== 0) {
    throw directReportUpdate.error ?? new Error("Admin bypassed the report resolution workflow");
  }
  const reportAfterDirectUpdate = await service.from("reports")
    .select("status")
    .eq("report_id", report.data.report_id)
    .single();
  if (reportAfterDirectUpdate.error || reportAfterDirectUpdate.data.status !== "pending") {
    throw reportAfterDirectUpdate.error ?? new Error("Direct report update changed the report");
  }
  const resolved = await admin.client.rpc("resolve_report", {
    p_report_id: report.data.report_id,
    p_status: "resolved",
    p_response: "Resolved once",
  });
  if (resolved.error) throw resolved.error;
  await expectFailure("finalized report replay", () =>
    admin.client.rpc("resolve_report", {
      p_report_id: report.data.report_id,
      p_status: "rejected",
      p_response: "Attempted replay",
    })
  );

  const supplier = await service.from("suppliers").insert({
    name: `CRUD supplier ${suffix}`,
    status: "pending",
    description: "Supplier business description",
  }).select("supplier_id").single();
  if (supplier.error) throw supplier.error;
  supplierId = supplier.data.supplier_id;
  const approved = await admin.client.rpc("approve_supplier", {
    p_supplier_id: supplierId,
    p_status: "approved",
    p_response: "Admin approval note must not replace the supplier description",
  });
  if (approved.error) throw approved.error;
  await expectFailure("supplier approval replay", () =>
    admin.client.rpc("approve_supplier", {
      p_supplier_id: supplierId,
      p_status: "rejected",
      p_response: "Attempted replay",
    })
  );
  const supplierAfter = await service.from("suppliers").select("status,description")
    .eq("supplier_id", supplierId).single();
  if (supplierAfter.error || supplierAfter.data.status !== "approved"
    || supplierAfter.data.description !== "Supplier business description") {
    throw supplierAfter.error ?? new Error("Supplier approval corrupted supplier data");
  }

  const room = await customer.client.rpc("create_chat_room", {
    p_type: "customer_manager",
    p_other_user_id: manager.userId,
    p_order_id: null,
    p_product_id: first.product_id,
  });
  if (room.error) throw room.error;
  roomIds.push(room.data);
  const validShare = await customer.client.from("chat_messages").insert({
    room_id: room.data,
    sender_id: customer.userId,
    message: null,
    shared_order_id: order.data.order_id,
  }).select("message_id").single();
  if (validShare.error) throw validShare.error;
  const secondMessage = await manager.client.from("chat_messages").insert({
    room_id: room.data,
    sender_id: manager.userId,
    message: "Second message",
  }).select("message_id").single();
  if (secondMessage.error) throw secondMessage.error;

  const reaction = await customer.client.from("chat_message_reactions").insert({
    message_id: validShare.data.message_id,
    user_id: customer.userId,
    reaction: "like",
  }).select("reaction_id").single();
  if (reaction.error) throw reaction.error;
  const movedReaction = await customer.client.from("chat_message_reactions")
    .update({ message_id: secondMessage.data.message_id, reaction: "love" })
    .eq("reaction_id", reaction.data.reaction_id)
    .select("message_id,reaction")
    .single();
  if (movedReaction.error || movedReaction.data.message_id !== validShare.data.message_id
    || movedReaction.data.reaction !== "love") {
    throw movedReaction.error ?? new Error("Reaction update changed its message");
  }

  const unrelatedRoom = await otherCustomer.client.rpc("create_chat_room", {
    p_type: "customer_manager",
    p_other_user_id: manager.userId,
    p_order_id: null,
    p_product_id: first.product_id,
  });
  if (unrelatedRoom.error) throw unrelatedRoom.error;
  roomIds.push(unrelatedRoom.data);
  await expectFailure("order share to unrelated participant", () =>
    manager.client.from("chat_messages").insert({
      room_id: unrelatedRoom.data,
      sender_id: manager.userId,
      message: null,
      shared_order_id: order.data.order_id,
    })
  );

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "profile field protection",
      "admin user-governance bypass protection",
      "root cart deletion protection",
      "cart create, update, and delete",
      "notification read-only mutation",
      "review create and immutable relation update",
      "report workflow bypass protection",
      "report validation and terminal status",
      "supplier approval terminal status",
      "related order sharing",
      "reaction relation immutability",
    ],
  }, null, 2));
} finally {
  await cleanup();
}
