import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0];
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
const password = Deno.env.get("FRESHTRACE_DEMO_PASSWORD") ?? "FreshTrace!123";

if (!baseUrl || !publishableKey || !secretKey) {
  throw new Error(
    "Usage: deno run --allow-env --allow-net scripts/seed-demo-data.ts <url> <publishable-key> <secret-key>",
  );
}

type Role = "admin" | "manager" | "employee" | "customer";
type DemoUser = {
  email: string;
  name: string;
  role: Role;
  phone: string;
  address: string;
};
type SignedInUser = DemoUser & {
  userId: string;
  client: SupabaseClient;
};

const demoUsers: DemoUser[] = [
  {
    email: "admin@freshtrace.local",
    name: "FreshTrace Admin",
    role: "admin",
    phone: "0901000001",
    address: "FreshTrace Head Office",
  },
  {
    email: "manager@freshtrace.local",
    name: "Da Lat Operations Manager",
    role: "manager",
    phone: "0901000002",
    address: "Da Lat Distribution Center",
  },
  {
    email: "manager.hcm@freshtrace.local",
    name: "HCMC Fulfillment Manager",
    role: "manager",
    phone: "0901000007",
    address: "Ho Chi Minh Fulfillment Center",
  },
  {
    email: "shipper@freshtrace.local",
    name: "FreshTrace Shipper",
    role: "employee",
    phone: "0901000003",
    address: "Ho Chi Minh City",
  },
  {
    email: "shipper.linh@freshtrace.local",
    name: "Linh Delivery Shipper",
    role: "employee",
    phone: "0901000008",
    address: "Thu Duc City",
  },
  {
    email: "customer@freshtrace.local",
    name: "Demo Customer",
    role: "customer",
    phone: "0901000004",
    address: "123 Nguyen Hue, District 1, Ho Chi Minh City",
  },
  {
    email: "customer.lan@freshtrace.local",
    name: "Lan Nguyen",
    role: "customer",
    phone: "0901000005",
    address: "45 Le Loi, District 1, Ho Chi Minh City",
  },
];

const admin = createClient(baseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const retainedEmails = new Set(demoUsers.map((user) => user.email));
const legacyDemoEmails = [
  "customer.minh@freshtrace.local",
];

async function ensureUser(definition: DemoUser): Promise<SignedInUser> {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  let authUser = listed.data.users.find((item) => item.email === definition.email);

  if (!authUser) {
    const created = await admin.auth.admin.createUser({
      email: definition.email,
      password,
      email_confirm: true,
      user_metadata: { name: definition.name },
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`Could not create ${definition.email}`);
    }
    authUser = created.data.user;
  } else {
    const updated = await admin.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: { name: definition.name },
    });
    if (updated.error) throw updated.error;
  }

  const role = await admin.from("roles").select("role_id")
    .eq("role_name", definition.role).single();
  if (role.error) throw role.error;

  const profile = await admin.from("users")
    .update({
      role_id: role.data.role_id,
      name: definition.name,
      phone: definition.phone,
      address: definition.address,
      status: "active",
    })
    .eq("auth_user_id", authUser.id)
    .select("user_id")
    .single();
  if (profile.error) throw profile.error;

  const client = createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({
    email: definition.email,
    password,
  });
  if (signedIn.error) throw signedIn.error;

  return { ...definition, userId: profile.data.user_id, client };
}

async function addCartItem(
  customer: SignedInUser,
  productId: string,
  batchId: string,
  quantity: number,
  note: string,
) {
  const cart = await customer.client.from("carts").select("cart_id").single();
  if (cart.error) throw cart.error;
  const cleared = await customer.client.from("cart_items").delete()
    .eq("cart_id", cart.data.cart_id);
  if (cleared.error) throw cleared.error;
  const inserted = await customer.client.from("cart_items").insert({
    cart_id: cart.data.cart_id,
    product_id: productId,
    batch_id: batchId,
    quantity,
    note,
  });
  if (inserted.error) throw inserted.error;
}

async function createPendingOrder(
  customer: SignedInUser,
  note = "FreshTrace demo pending order",
  productId = "30000000-0000-0000-0000-000000000001",
  batchId = "40000000-0000-0000-0000-000000000001",
) {
  const existing = await admin.from("orders").select("order_id")
    .eq("user_id", customer.userId)
    .eq("note", note)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.order_id as string;

  await addCartItem(
    customer,
    productId,
    batchId,
    2,
    "Keep the spinach cool",
  );
  const order = await customer.client.rpc("checkout_cart", {
    p_delivery_address: customer.address,
    p_payment_method: "cod",
    p_delivery_fee: 15000,
    p_note: note,
  });
  if (order.error) throw order.error;
  return order.data as string;
}

async function createCompletedOrder(
  customer: SignedInUser,
  manager: SignedInUser,
  shipper: SignedInUser,
  note = "FreshTrace demo completed order",
  productId = "30000000-0000-0000-0000-000000000007",
  batchId = "40000000-0000-0000-0000-000000000007",
) {
  const existing = await admin.from("orders").select("order_id")
    .eq("user_id", customer.userId)
    .eq("note", note)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.order_id as string;

  await addCartItem(
    customer,
    productId,
    batchId,
    1,
    "Please avoid crushing the tomato box",
  );
  const checkout = await customer.client.rpc("checkout_cart", {
    p_delivery_address: customer.address,
    p_payment_method: "cod",
    p_delivery_fee: 15000,
    p_note: note,
  });
  if (checkout.error) throw checkout.error;
  const orderId = checkout.data as string;

  const confirmed = await manager.client.rpc("confirm_order", { p_order_id: orderId });
  if (confirmed.error) throw confirmed.error;
  const preparing = await manager.client.rpc("mark_order_preparing", { p_order_id: orderId });
  if (preparing.error) throw preparing.error;
  const assigned = await manager.client.rpc("assign_delivery", {
    p_order_id: orderId,
    p_employee_id: shipper.userId,
  });
  if (assigned.error) throw assigned.error;

  const deliveryId = assigned.data as string;
  const verified = await shipper.client.rpc("verify_delivery_batch", {
    p_delivery_id: deliveryId,
    p_batch_id: batchId,
  });
  if (verified.error) throw verified.error;

  for (const status of ["picked_up", "delivering"] as const) {
    const updated = await shipper.client.rpc("update_delivery_status", {
      p_delivery_id: deliveryId,
      p_status: status,
      p_note: `Demo delivery: ${status}`,
      p_proof_image_url: null,
    });
    if (updated.error) throw updated.error;
  }
  const collected = await shipper.client.rpc("record_delivery_collection", {
    p_delivery_id: deliveryId,
    p_method: "bank_transfer",
    p_proof_url: null,
  });
  if (collected.error) throw collected.error;
  const delivered = await shipper.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: "delivered",
    p_note: "Demo order delivered successfully",
    p_proof_image_url: null,
  });
  if (delivered.error) throw delivered.error;
  return orderId;
}

async function ensureCustomerContent(customer: SignedInUser, orderId: string, productId = "30000000-0000-0000-0000-000000000007") {
  const review = await admin.from("reviews").upsert({
    user_id: customer.userId,
    order_id: orderId,
    product_id: productId,
    rating: 5,
    comment: "Fresh product, clear traceability, and careful delivery.",
  }, { onConflict: "user_id,product_id,order_id" });
  if (review.error) throw review.error;

  const existingReport = await admin.from("reports").select("report_id")
    .eq("user_id", customer.userId)
    .eq("description", "Demo report for the Admin resolution workflow.")
    .maybeSingle();
  if (existingReport.error) throw existingReport.error;
  if (!existingReport.data) {
    const report = await customer.client.from("reports").insert({
      user_id: customer.userId,
      order_id: orderId,
      product_id: productId,
      type: "product_quality",
      description: "Demo report for the Admin resolution workflow.",
    });
    if (report.error) throw report.error;
  }
}

async function ensureConversation(
  creator: SignedInUser,
  other: SignedInUser,
  type: "customer_manager" | "customer_shipper",
  orderId: string | null,
  message: string,
) {
  const room = await creator.client.rpc("create_chat_room", {
    p_type: type,
    p_other_user_id: other.userId,
    p_order_id: orderId,
    p_product_id: null,
  });
  if (room.error) throw room.error;
  const existing = await admin.from("chat_messages").select("message_id")
    .eq("room_id", room.data)
    .eq("message", message)
    .maybeSingle();
  if (existing.error) throw existing.error;
  let messageId = existing.data?.message_id as string | undefined;
  if (!messageId) {
    const inserted = await creator.client.from("chat_messages").insert({
      room_id: room.data,
      sender_id: creator.userId,
      message,
    }).select("message_id").single();
    if (inserted.error) throw inserted.error;
    messageId = inserted.data.message_id;
  }
  const reaction = await admin.from("chat_message_reactions").upsert({
    message_id: messageId,
    user_id: other.userId,
    reaction: "like",
  }, { onConflict: "message_id,user_id" });
  if (reaction.error) throw reaction.error;
}

const signedInUsers = await Promise.all(demoUsers.map(ensureUser));
for (const email of legacyDemoEmails) {
  if (retainedEmails.has(email)) continue;
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const legacy = listed.data.users.find((item) => item.email === email);
  if (legacy) {
    await admin.auth.admin.deleteUser(legacy.id);
    await admin.from("users").delete().eq("auth_user_id", legacy.id);
  }
}
const byEmail = Object.fromEntries(signedInUsers.map((user) => [user.email, user]));
const systemAdmin = byEmail["admin@freshtrace.local"];
const manager = byEmail["manager@freshtrace.local"];
const employee = byEmail["shipper@freshtrace.local"];
const secondEmployee = byEmail["shipper.linh@freshtrace.local"];
const customer = byEmail["customer@freshtrace.local"];
const customerLan = byEmail["customer.lan@freshtrace.local"];

await createPendingOrder(customer);
await createPendingOrder(
  customerLan,
  "FreshTrace demo Rescue order",
  "30000000-0000-0000-0000-000000000012",
  "40000000-0000-0000-0000-000000000012",
);
const completedOrderId = await createCompletedOrder(
  customer,
  manager,
  employee,
);
const secondCompletedOrderId = await createCompletedOrder(
  customerLan,
  manager,
  secondEmployee,
  "FreshTrace demo completed avocado order",
  "30000000-0000-0000-0000-000000000009",
  "40000000-0000-0000-0000-000000000009",
);
await ensureCustomerContent(customer, completedOrderId);
await ensureCustomerContent(customerLan, secondCompletedOrderId, "30000000-0000-0000-0000-000000000009");
await ensureConversation(
  customer,
  manager,
  "customer_manager",
  null,
  "Hello Manager, I would like advice about today’s Fresh Rescue products.",
);
await ensureConversation(
  customer,
  employee,
  "customer_shipper",
  completedOrderId,
  "Thank you for delivering the demo order.",
);

const adminNotice = await admin.from("notifications").select("notification_id")
  .eq("user_id", systemAdmin.userId)
  .eq("title", "Demo analytics ready")
  .maybeSingle();
if (adminNotice.error) throw adminNotice.error;
if (!adminNotice.data) {
  const inserted = await admin.from("notifications").insert({
    user_id: systemAdmin.userId,
    title: "Demo analytics ready",
    content: "Customer analytics and financial report data are available.",
    type: "system",
    target_url: "/admin/finance",
  });
  if (inserted.error) throw inserted.error;
}

console.log("FreshTrace demo data is ready.");
for (const user of demoUsers) {
  console.log(`  ${user.role.padEnd(8)} ${user.email}`);
}
console.log(`  password ${password}`);
