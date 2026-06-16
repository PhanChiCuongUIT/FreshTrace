import { createClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0];
const serviceRoleKey = Deno.args[1];
const dryRun = Deno.args.includes("--dry-run");

if (!baseUrl || !serviceRoleKey) {
  throw new Error(
    "Usage: deno run --allow-net scripts/cleanup-test-data.ts <supabase-url> <service-role-key> [--dry-run]",
  );
}

const supabase = createClient(baseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Profile = {
  user_id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  roles?: { role_name?: string } | Array<{ role_name?: string }> | null;
};

type ChatRoom = {
  room_id: string;
  type: string;
  order_id: string | null;
  product_id: string | null;
  created_at: string;
};

type ChatMember = {
  room_id: string;
  user_id: string;
};

type Summary = Record<string, number>;

const retainedDemoEmails = new Set([
  "admin@freshtrace.local",
  "manager@freshtrace.local",
  "manager.hcm@freshtrace.local",
  "shipper@freshtrace.local",
  "shipper.linh@freshtrace.local",
  "customer@freshtrace.local",
  "customer.lan@freshtrace.local",
]);

const testEmailPatterns = [
  /^smoke\.\d+@freshtrace\.local$/i,
  /^catalog-(admin|manager)-\d+@freshtrace\.local$/i,
  /^(customer|other-customer|manager|employee|other-employee|admin)\.\d+@freshtrace\.local$/i,
  /^coupon\.\d+@freshtrace\.local$/i,
  /^coupon-policy-[a-z-]+-\d+@freshtrace\.local$/i,
  /^report-flow-[a-z-]+-\d+@freshtrace\.local$/i,
  /^non-manager-crud-[a-z-]+-\d+@freshtrace\.local$/i,
  /^customer\.minh@freshtrace\.local$/i,
];

const textMarkers = [
  "smoke test",
  "integration test",
  "catalog crud test",
  "catalog constraint test",
  "catalog relation",
  "catalog workflow verification",
  "non-manager crud",
  "report workflow integration",
  "report notification integration",
  "coupon policy integration",
  "coupon deletion integration",
  "coupon lifecycle test",
  "freshtrace smoke test",
  "crud_test",
];

const catalogNameMarkers = [
  /^manager supplier \d+$/i,
  /^pending supplier \d+$/i,
  /^approved supplier \d+$/i,
  /^alternate supplier \d+$/i,
  /^catalog test category \d+$/i,
  /^catalog product \d+$/i,
  /^rejected product \d+$/i,
  /^catalog rescue \d+$/i,
  /^disposable category \d+$/i,
  /^disposable supplier \d+$/i,
  /^disposable product \d+$/i,
  /^crud supplier \d+$/i,
];

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function roleName(profile: Profile | undefined): string {
  return one(profile?.roles)?.role_name ?? "";
}

function isMarkedText(value: unknown): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return textMarkers.some((marker) => normalized.includes(marker));
}

function isTestEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? "").toLowerCase();
  return !retainedDemoEmails.has(normalized) && testEmailPatterns.some((pattern) => pattern.test(normalized));
}

function isCatalogTestName(value: unknown): boolean {
  const normalized = String(value ?? "").trim();
  return catalogNameMarkers.some((pattern) => pattern.test(normalized)) || isMarkedText(normalized);
}

function pushAll<T>(target: Set<T>, values: Array<T | null | undefined>) {
  for (const value of values) {
    if (value) target.add(value);
  }
}

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1;; page++) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
  }
  return users;
}

async function selectAll<T>(table: string, columns = "*"): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0;; from += pageSize) {
    const result = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    rows.push(...((result.data ?? []) as T[]));
    if ((result.data ?? []).length < pageSize) break;
  }
  return rows;
}

async function deleteIn(table: string, column: string, ids: Set<string>, summary: Summary) {
  if (ids.size === 0) return;
  summary[table] = (summary[table] ?? 0) + ids.size;
  if (dryRun) return;

  const values = [...ids];
  for (let index = 0; index < values.length; index += 100) {
    const chunk = values.slice(index, index + 100);
    const result = await supabase.from(table).delete().in(column, chunk);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
  }
}

async function deleteWhereEq(table: string, column: string, value: string, summary: Summary) {
  summary[table] = (summary[table] ?? 0) + 1;
  if (dryRun) return;
  const result = await supabase.from(table).delete().eq(column, value);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
}

async function updateIn(table: string, column: string, ids: Set<string>, values: Record<string, unknown>) {
  if (dryRun || ids.size === 0) return;
  const result = await supabase.from(table).update(values).in(column, [...ids]);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
}

const summary: Summary = {};

const [authUsers, profiles] = await Promise.all([
  listAllAuthUsers(),
  selectAll<Profile>("users", "user_id,auth_user_id,email,name,roles(role_name)"),
]);

const profileById = new Map(profiles.map((profile) => [profile.user_id, profile]));
const testUserIds = new Set<string>();
const testAuthUserIds = new Set<string>();

for (const profile of profiles) {
  if (isTestEmail(profile.email) || isMarkedText(profile.name)) {
    testUserIds.add(profile.user_id);
    if (profile.auth_user_id) testAuthUserIds.add(profile.auth_user_id);
  }
}

for (const user of authUsers) {
  if (isTestEmail(user.email)) testAuthUserIds.add(user.id);
}

const [
  orders,
  carts,
  cartItems,
  deliveries,
  payments,
  collections,
  payosRequests,
  reports,
  reviews,
  rooms,
  members,
  messages,
  assistantLogs,
  coupons,
  notifications,
  transactions,
  suppliers,
  categories,
  products,
  batches,
  prices,
  rescueDeals,
] = await Promise.all([
  selectAll<{ order_id: string; user_id: string; note: string | null; delivery_address: string | null }>("orders", "order_id,user_id,note,delivery_address"),
  selectAll<{ cart_id: string; user_id: string }>("carts", "cart_id,user_id"),
  selectAll<{ cart_item_id: string; cart_id: string; note: string | null }>("cart_items", "cart_item_id,cart_id,note"),
  selectAll<{ delivery_id: string; order_id: string; employee_id: string | null; note: string | null; proof_image_url: string | null }>("deliveries", "delivery_id,order_id,employee_id,note,proof_image_url"),
  selectAll<{ payment_id: string; order_id: string; provider_payload: unknown; transaction_id: string | null }>("payments", "payment_id,order_id,provider_payload,transaction_id"),
  selectAll<{ collection_id: string; delivery_id: string; payment_id: string; collected_by: string; proof_url: string | null }>("delivery_payment_collections", "collection_id,delivery_id,payment_id,collected_by,proof_url"),
  selectAll<{ request_id: string; payment_id: string; delivery_id: string | null; collection_id: string | null; requested_by: string; provider_payload: unknown; transaction_id: string | null; qr_code: string | null }>("payos_requests", "request_id,payment_id,delivery_id,collection_id,requested_by,provider_payload,transaction_id,qr_code"),
  selectAll<{ report_id: string; user_id: string; reported_user_id: string | null; resolved_by: string | null; order_id: string | null; description: string; type: string }>("reports", "report_id,user_id,reported_user_id,resolved_by,order_id,description,type"),
  selectAll<{ review_id: string; user_id: string; order_id: string; comment: string | null }>("reviews", "review_id,user_id,order_id,comment"),
  selectAll<ChatRoom>("chat_rooms", "room_id,type,order_id,product_id,created_at"),
  selectAll<ChatMember>("chat_room_members", "room_id,user_id"),
  selectAll<{ message_id: string; room_id: string; sender_id: string; message: string | null; attachment_name: string | null }>("chat_messages", "message_id,room_id,sender_id,message,attachment_name"),
  selectAll<{ log_id: string; user_id: string | null; question: string; answer: string; intent: string | null }>("assistant_logs", "log_id,user_id,question,answer,intent"),
  selectAll<{ coupon_id: string; user_id: string; source_order_id: string | null; used_order_id: string | null; code: string; description: string | null }>("coupons", "coupon_id,user_id,source_order_id,used_order_id,code,description"),
  selectAll<{ notification_id: string; user_id: string; title: string; content: string | null }>("notifications", "notification_id,user_id,title,content"),
  selectAll<{ transaction_id: string; batch_id: string; created_by: string | null; note: string | null }>("inventory_transactions", "transaction_id,batch_id,created_by,note"),
  selectAll<{ supplier_id: string; name: string; description: string | null; certificate: string | null; approved_by: string | null }>("suppliers", "supplier_id,name,description,certificate,approved_by"),
  selectAll<{ category_id: string; name: string; description: string | null }>("categories", "category_id,name,description"),
  selectAll<{ product_id: string; category_id: string | null; supplier_id: string | null; name: string; description: string | null }>("products", "product_id,category_id,supplier_id,name,description"),
  selectAll<{ batch_id: string; product_id: string; supplier_id: string | null; batch_code: string; origin_location: string | null }>("batches", "batch_id,product_id,supplier_id,batch_code,origin_location"),
  selectAll<{ price_id: string; product_id: string; batch_id: string | null }>("prices", "price_id,product_id,batch_id"),
  selectAll<{ deal_id: string; batch_id: string; title: string; description: string | null; created_by: string | null }>("fresh_rescue_deals", "deal_id,batch_id,title,description,created_by"),
]);

const cartIdsByTestUser = new Set(carts.filter((cart) => testUserIds.has(cart.user_id)).map((cart) => cart.cart_id));
const testOrderIds = new Set<string>();
for (const order of orders) {
  if (testUserIds.has(order.user_id) || isMarkedText(order.note) || isMarkedText(order.delivery_address)) {
    testOrderIds.add(order.order_id);
  }
}

const testDeliveryIds = new Set<string>();
for (const delivery of deliveries) {
  if (testOrderIds.has(delivery.order_id) || (delivery.employee_id && testUserIds.has(delivery.employee_id))
    || isMarkedText(delivery.note) || isMarkedText(delivery.proof_image_url)) {
    testDeliveryIds.add(delivery.delivery_id);
  }
}

const testPaymentIds = new Set<string>();
for (const payment of payments) {
  if (testOrderIds.has(payment.order_id) || isMarkedText(JSON.stringify(payment.provider_payload)) || isMarkedText(payment.transaction_id)) {
    testPaymentIds.add(payment.payment_id);
  }
}

const testCollectionIds = new Set<string>();
for (const collection of collections) {
  if (testDeliveryIds.has(collection.delivery_id) || testPaymentIds.has(collection.payment_id)
    || testUserIds.has(collection.collected_by) || isMarkedText(collection.proof_url)) {
    testCollectionIds.add(collection.collection_id);
  }
}

const testPayosRequestIds = new Set<string>();
for (const request of payosRequests) {
  if (testPaymentIds.has(request.payment_id)
    || (request.delivery_id && testDeliveryIds.has(request.delivery_id))
    || (request.collection_id && testCollectionIds.has(request.collection_id))
    || testUserIds.has(request.requested_by)
    || isMarkedText(JSON.stringify(request.provider_payload))
    || isMarkedText(request.transaction_id)
    || isMarkedText(request.qr_code)) {
    testPayosRequestIds.add(request.request_id);
  }
}

const testReportIds = new Set<string>();
for (const report of reports) {
  if (testUserIds.has(report.user_id)
    || (report.reported_user_id && testUserIds.has(report.reported_user_id))
    || (report.resolved_by && testUserIds.has(report.resolved_by))
    || (report.order_id && testOrderIds.has(report.order_id))
    || isMarkedText(report.description)
    || isMarkedText(report.type)) {
    testReportIds.add(report.report_id);
  }
}

const testReviewIds = new Set<string>();
for (const review of reviews) {
  if (testUserIds.has(review.user_id) || testOrderIds.has(review.order_id) || isMarkedText(review.comment)) {
    testReviewIds.add(review.review_id);
  }
}

const membersByRoom = new Map<string, ChatMember[]>();
for (const member of members) {
  const list = membersByRoom.get(member.room_id) ?? [];
  list.push(member);
  membersByRoom.set(member.room_id, list);
}

const testRoomIds = new Set<string>();
const testMessageIds = new Set<string>();
for (const message of messages) {
  if (testUserIds.has(message.sender_id) || isMarkedText(message.message) || isMarkedText(message.attachment_name)) {
    testMessageIds.add(message.message_id);
    testRoomIds.add(message.room_id);
  }
}
for (const room of rooms) {
  const roomMembers = membersByRoom.get(room.room_id) ?? [];
  if ((room.order_id && testOrderIds.has(room.order_id)) || roomMembers.some((member) => testUserIds.has(member.user_id))) {
    testRoomIds.add(room.room_id);
  }
}

const duplicateCustomerManagerRoomIds = new Set<string>();
const canonicalCustomerManagerRoomIds = new Set<string>();
const roomsByPair = new Map<string, ChatRoom[]>();
for (const room of rooms.filter((item) => item.type === "customer_manager" && !testRoomIds.has(item.room_id))) {
  const roomMembers = membersByRoom.get(room.room_id) ?? [];
  const customer = roomMembers.find((member) => roleName(profileById.get(member.user_id)) === "customer");
  const manager = roomMembers.find((member) => roleName(profileById.get(member.user_id)) === "manager");
  if (!customer || !manager) continue;
  const key = `${customer.user_id}:${manager.user_id}`;
  const list = roomsByPair.get(key) ?? [];
  list.push(room);
  roomsByPair.set(key, list);
}
for (const list of roomsByPair.values()) {
  list.sort((left, right) => {
    if ((left.order_id === null) !== (right.order_id === null)) return left.order_id === null ? -1 : 1;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
  const [canonical, ...duplicates] = list;
  if (!canonical) continue;
  canonicalCustomerManagerRoomIds.add(canonical.room_id);
  for (const duplicate of duplicates) duplicateCustomerManagerRoomIds.add(duplicate.room_id);
}

for (const id of duplicateCustomerManagerRoomIds) testRoomIds.add(id);

const testAssistantLogIds = new Set<string>();
for (const log of assistantLogs) {
  if ((log.user_id && testUserIds.has(log.user_id)) || isMarkedText(log.question) || isMarkedText(log.answer) || isMarkedText(log.intent)) {
    testAssistantLogIds.add(log.log_id);
  }
}

const testCouponIds = new Set<string>();
for (const coupon of coupons) {
  if (testUserIds.has(coupon.user_id)
    || (coupon.source_order_id && testOrderIds.has(coupon.source_order_id))
    || (coupon.used_order_id && testOrderIds.has(coupon.used_order_id))
    || isMarkedText(coupon.code)
    || isMarkedText(coupon.description)) {
    testCouponIds.add(coupon.coupon_id);
  }
}

const testNotificationIds = new Set<string>();
for (const notification of notifications) {
  if (testUserIds.has(notification.user_id)
    || isMarkedText(notification.title)
    || isMarkedText(notification.content)
    || notification.title === "Demo analytics ready") {
    testNotificationIds.add(notification.notification_id);
  }
}

const testSupplierIds = new Set<string>();
for (const supplier of suppliers) {
  if (isCatalogTestName(supplier.name) || isCatalogTestName(supplier.description) || isMarkedText(supplier.certificate)
    || (supplier.approved_by && testUserIds.has(supplier.approved_by))) {
    testSupplierIds.add(supplier.supplier_id);
  }
}

const testCategoryIds = new Set<string>();
for (const category of categories) {
  if (isCatalogTestName(category.name) || isCatalogTestName(category.description)) {
    testCategoryIds.add(category.category_id);
  }
}

const testProductIds = new Set<string>();
for (const product of products) {
  if (testSupplierIds.has(product.supplier_id ?? "")
    || testCategoryIds.has(product.category_id ?? "")
    || isCatalogTestName(product.name)
    || isCatalogTestName(product.description)) {
    testProductIds.add(product.product_id);
  }
}

const testBatchIds = new Set<string>();
for (const batch of batches) {
  if (testProductIds.has(batch.product_id)
    || testSupplierIds.has(batch.supplier_id ?? "")
    || /^(CRUD|ROLLBACK|INACTIVE|PENDING|INVALID)-\d+$/i.test(batch.batch_code)
    || isMarkedText(batch.origin_location)) {
    testBatchIds.add(batch.batch_id);
  }
}

const testPriceIds = new Set<string>();
for (const price of prices) {
  if (testProductIds.has(price.product_id) || (price.batch_id && testBatchIds.has(price.batch_id))) {
    testPriceIds.add(price.price_id);
  }
}

const testRescueDealIds = new Set<string>();
for (const deal of rescueDeals) {
  if (testBatchIds.has(deal.batch_id) || isCatalogTestName(deal.title) || isCatalogTestName(deal.description)
    || (deal.created_by && testUserIds.has(deal.created_by))) {
    testRescueDealIds.add(deal.deal_id);
  }
}

const testTransactionIds = new Set<string>();
for (const transaction of transactions) {
  if (testBatchIds.has(transaction.batch_id) || (transaction.created_by && testUserIds.has(transaction.created_by)) || isMarkedText(transaction.note)) {
    testTransactionIds.add(transaction.transaction_id);
  }
}

for (const item of cartItems) {
  if (cartIdsByTestUser.has(item.cart_id) || isMarkedText(item.note)) {
    summary.cart_items = (summary.cart_items ?? 0) + 1;
    if (!dryRun) {
      const result = await supabase.from("cart_items").delete().eq("cart_item_id", item.cart_item_id);
      if (result.error) throw new Error(`cart_items: ${result.error.message}`);
    }
  }
}

await deleteIn("chat_messages", "message_id", testMessageIds, summary);
await deleteIn("chat_rooms", "room_id", testRoomIds, summary);
await updateIn("chat_rooms", "room_id", canonicalCustomerManagerRoomIds, { order_id: null, product_id: null });
summary.customer_manager_duplicate_rooms = duplicateCustomerManagerRoomIds.size;

await deleteIn("reports", "report_id", testReportIds, summary);
await deleteIn("reviews", "review_id", testReviewIds, summary);
await deleteIn("assistant_logs", "log_id", testAssistantLogIds, summary);
await deleteIn("notifications", "notification_id", testNotificationIds, summary);
await deleteIn("coupons", "coupon_id", testCouponIds, summary);
await deleteIn("payos_requests", "request_id", testPayosRequestIds, summary);
await deleteIn("delivery_payment_collections", "collection_id", testCollectionIds, summary);
await deleteIn("delivery_batch_checks", "delivery_id", testDeliveryIds, summary);
await deleteIn("deliveries", "delivery_id", testDeliveryIds, summary);
await deleteIn("payments", "payment_id", testPaymentIds, summary);
await deleteIn("order_manager_assignments", "order_id", testOrderIds, summary);
await deleteIn("order_tracking", "order_id", testOrderIds, summary);
await deleteIn("order_items", "order_id", testOrderIds, summary);
await deleteIn("orders", "order_id", testOrderIds, summary);
await deleteIn("inventory_transactions", "transaction_id", testTransactionIds, summary);
await deleteIn("fresh_rescue_deals", "deal_id", testRescueDealIds, summary);
await deleteIn("prices", "price_id", testPriceIds, summary);
await deleteIn("batches", "batch_id", testBatchIds, summary);
await deleteIn("products", "product_id", testProductIds, summary);

if (testSupplierIds.size > 0) {
  for (const supplierId of testSupplierIds) {
    await deleteWhereEq("supplier_approval_history", "supplier_id", supplierId, summary);
  }
}
await deleteIn("suppliers", "supplier_id", testSupplierIds, summary);
await deleteIn("categories", "category_id", testCategoryIds, summary);
await deleteIn("carts", "cart_id", cartIdsByTestUser, summary);

if (!dryRun) {
  for (const authUserId of testAuthUserIds) {
    const result = await supabase.auth.admin.deleteUser(authUserId);
    if (result.error && !/not found/i.test(result.error.message)) {
      throw new Error(`auth.users: ${result.error.message}`);
    }
  }
  const orphanProfileIds = new Set(
    [...testUserIds].filter((userId) => profileById.has(userId)),
  );
  await deleteIn("users", "user_id", orphanProfileIds, summary);
} else {
  summary.auth_users = testAuthUserIds.size;
  summary.users = testUserIds.size;
}

console.log(JSON.stringify({
  mode: dryRun ? "dry-run" : "cleanup",
  baseUrl,
  retainedDemoUsers: retainedDemoEmails.size,
  testUsers: testUserIds.size,
  testAuthUsers: testAuthUserIds.size,
  duplicateCustomerManagerRooms: duplicateCustomerManagerRoomIds.size,
  affected: Object.fromEntries(Object.entries(summary).sort(([left], [right]) => left.localeCompare(right))),
}, null, 2));
