import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!publishableKey || !secretKey) {
  throw new Error("Usage: deno run --allow-net report-notification-test.ts <url> <publishable-key> <secret-key>");
}

const service = createClient(baseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = Date.now();
const authIds: string[] = [];
const userIds: string[] = [];
let orderId = "";
const reportIds: string[] = [];

async function createUser(role: "customer" | "manager" | "admin", label: string) {
  const email = `report-flow-${label}-${suffix}@freshtrace.local`;
  const password = "FreshTrace!123";
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Report flow ${label}` },
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("Could not create report test user");
  authIds.push(created.data.user.id);
  const roleRow = await service.from("roles").select("role_id").eq("role_name", role).single();
  if (roleRow.error) throw roleRow.error;
  const profile = await service.from("users").update({ role_id: roleRow.data.role_id })
    .eq("auth_user_id", created.data.user.id).select("user_id").single();
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
  if (reportIds.length) await service.from("reports").delete().in("report_id", reportIds);
  if (userIds.length) {
    await service.from("notifications").delete().in("user_id", userIds);
    await service.from("coupons").delete().in("user_id", userIds);
  }
  if (orderId) {
    await service.from("chat_rooms").delete().eq("order_id", orderId);
    await service.from("order_manager_assignments").delete().eq("order_id", orderId);
    await service.from("orders").delete().eq("order_id", orderId);
  }
  for (const userId of userIds) await service.from("users").delete().eq("user_id", userId);
  for (const authId of authIds.reverse()) await service.auth.admin.deleteUser(authId);
}

try {
  const customer = await createUser("customer", "customer");
  const manager = await createUser("manager", "manager");
  const admin = await createUser("admin", "admin");

  const order = await service.from("orders").insert({
    user_id: customer.userId,
    subtotal: 100000,
    total_amount: 100000,
    delivery_address: "Report workflow integration test",
    delivery_fee: 0,
  }).select("order_id").single();
  if (order.error) throw order.error;
  orderId = order.data.order_id;
  const assignment = await service.from("order_manager_assignments").upsert({
    order_id: orderId,
    manager_id: manager.userId,
  }, { onConflict: "order_id" });
  if (assignment.error) throw assignment.error;

  const reportable = await customer.client.rpc("list_reportable_users", {
    p_query: "Report flow manager",
    p_limit: 30,
  });
  if (reportable.error || !reportable.data.some((user: { user_id: string }) => user.user_id === manager.userId)) {
    throw reportable.error ?? new Error("Related manager was not reportable by the customer");
  }

  const userReport = await customer.client.from("reports").insert({
    user_id: customer.userId,
    reported_user_id: manager.userId,
    type: "user_report",
    description: "User report notification integration verification",
  }).select("report_id").single();
  if (userReport.error) throw userReport.error;
  reportIds.push(userReport.data.report_id);
  const userResolved = await admin.client.rpc("resolve_report", {
    p_report_id: userReport.data.report_id,
    p_status: "resolved",
    p_response: "User report reviewed and resolved",
  });
  if (userResolved.error) throw userResolved.error;

  const userNotifications = await service.from("notifications").select("user_id,type")
    .in("user_id", [customer.userId, manager.userId])
    .in("type", ["report_status", "user_report_resolved"]);
  if (userNotifications.error
    || !userNotifications.data.some((item) => item.user_id === customer.userId && item.type === "report_status")
    || !userNotifications.data.some((item) => item.user_id === manager.userId && item.type === "user_report_resolved")) {
    throw userNotifications.error ?? new Error("User report did not notify both affected users");
  }

  const orderReport = await customer.client.from("reports").insert({
    user_id: customer.userId,
    order_id: orderId,
    type: "order_issue",
    description: "Order report manager notification integration verification",
  }).select("report_id").single();
  if (orderReport.error) throw orderReport.error;
  reportIds.push(orderReport.data.report_id);
  const orderResolved = await admin.client.rpc("resolve_report", {
    p_report_id: orderReport.data.report_id,
    p_status: "resolved",
    p_response: "Order report reviewed and resolved",
  });
  if (orderResolved.error) throw orderResolved.error;

  const managerNotification = await service.from("notifications").select("notification_id")
    .eq("user_id", manager.userId).eq("type", "order_report_resolved").eq("target_url", `/manager/orders/${orderId}`);
  if (managerNotification.error || managerNotification.data.length !== 1) {
    throw managerNotification.error ?? new Error("Resolved order report did not notify its assigned manager");
  }

  console.log("PASS user report: only related users are selectable");
  console.log("PASS user report resolution: reporter and reported user are notified");
  console.log("PASS order report resolution: assigned manager is notified with the order link");
} finally {
  await cleanup();
}
