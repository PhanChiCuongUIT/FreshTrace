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
type DeliveryCollectionSeedRow = {
  collection_id: string;
  payment_id: string;
  amount: number;
  remittance_status: string;
  payments: { status: string } | Array<{ status: string }> | null;
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
let demoProviderOrderCode = Date.now() * 1000;

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

async function ensureDemoPayosRemittance(deliveryId: string, shipper: SignedInUser) {
  const collection = await admin.from("delivery_payment_collections")
    .select("collection_id,payment_id,amount,remittance_status,payments(status)")
    .eq("delivery_id", deliveryId)
    .maybeSingle();
  if (collection.error) throw collection.error;

  const collectionData = collection.data as DeliveryCollectionSeedRow | null;
  const payment = Array.isArray(collectionData?.payments)
    ? collectionData?.payments[0] ?? null
    : collectionData?.payments ?? null;
  if (collectionData?.remittance_status === "paid" || payment?.status === "paid") return;

  let activeCollection: DeliveryCollectionSeedRow | null = collectionData;
  if (!activeCollection) {
    const collected = await shipper.client.rpc("record_delivery_collection", {
      p_delivery_id: deliveryId,
      p_method: "cash",
      p_proof_url: null,
    });
    if (collected.error) throw collected.error;

    const refreshed = await admin.from("delivery_payment_collections")
      .select("collection_id,payment_id,amount,remittance_status,payments(status)")
      .eq("delivery_id", deliveryId)
      .single();
    if (refreshed.error) throw refreshed.error;
    activeCollection = refreshed.data as DeliveryCollectionSeedRow;
  }
  if (!activeCollection) throw new Error("Cash collection was not created");

  const providerOrderCode = ++demoProviderOrderCode;
  const remittanceRequest = await admin.from("payos_requests").insert({
    payment_id: activeCollection.payment_id,
    delivery_id: deliveryId,
    collection_id: activeCollection.collection_id,
    purpose: "shipper_remittance",
    requested_by: shipper.userId,
    provider_order_code: providerOrderCode,
    amount: activeCollection.amount,
    checkout_url: `https://pay.freshtrace.local/remittance/${providerOrderCode}`,
    qr_code: `FRESHTRACE-DEMO-REMITTANCE-${providerOrderCode}`,
    status: "pending",
    provider_payload: { source: "FreshTrace demo seed", purpose: "shipper_remittance" },
  });
  if (remittanceRequest.error) throw remittanceRequest.error;

  const remittance = await admin.rpc("confirm_payos_request", {
    p_provider_order_code: providerOrderCode,
    p_amount: activeCollection.amount,
    p_transaction_id: `demo-remittance-${providerOrderCode}`,
    p_payload: { source: "FreshTrace demo seed", purpose: "shipper_remittance" },
  });
  if (remittance.error) throw remittance.error;
}

async function ensureCompletedDeliveryState(
  orderId: string,
  manager: SignedInUser,
  shipper: SignedInUser,
  batchId: string,
) {
  const order = await admin.from("orders")
    .select("order_id,status,payments(status,method)")
    .eq("order_id", orderId)
    .single();
  if (order.error) throw order.error;
  if (order.data.status === "completed") return orderId;

  if (order.data.status === "pending") {
    const confirmed = await manager.client.rpc("confirm_order", { p_order_id: orderId });
    if (confirmed.error) throw confirmed.error;
  }

  const afterConfirm = await admin.from("orders")
    .select("status")
    .eq("order_id", orderId)
    .single();
  if (afterConfirm.error) throw afterConfirm.error;
  if (afterConfirm.data.status === "confirmed") {
    const preparing = await manager.client.rpc("mark_order_preparing", { p_order_id: orderId });
    if (preparing.error) throw preparing.error;
  }

  let delivery = await admin.from("deliveries")
    .select("delivery_id,status,employee_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (delivery.error) throw delivery.error;
  let deliveryId = delivery.data?.delivery_id as string | undefined;

  if (!deliveryId) {
    const assigned = await manager.client.rpc("assign_delivery", {
      p_order_id: orderId,
      p_employee_id: shipper.userId,
    });
    if (assigned.error) throw assigned.error;
    deliveryId = assigned.data as string;
    delivery = await admin.from("deliveries")
      .select("delivery_id,status,employee_id")
      .eq("delivery_id", deliveryId)
      .single();
    if (delivery.error) throw delivery.error;
  }

  const checks = await admin.from("delivery_batch_checks")
    .select("id")
    .eq("delivery_id", deliveryId)
    .eq("batch_id", batchId)
    .eq("matched", true)
    .maybeSingle();
  if (checks.error) throw checks.error;
  if (!checks.data) {
    const verified = await shipper.client.rpc("verify_delivery_batch", {
      p_delivery_id: deliveryId,
      p_batch_id: batchId,
    });
    if (verified.error) throw verified.error;
  }

  let status = delivery.data?.status as string | undefined;
  if (status === "assigned") {
    const pickedUp = await shipper.client.rpc("update_delivery_status", {
      p_delivery_id: deliveryId,
      p_status: "picked_up",
      p_note: "Demo delivery: picked_up",
      p_proof_image_url: null,
    });
    if (pickedUp.error) throw pickedUp.error;
    status = "picked_up";
  }
  if (status === "picked_up") {
    const delivering = await shipper.client.rpc("update_delivery_status", {
      p_delivery_id: deliveryId,
      p_status: "delivering",
      p_note: "Demo delivery: delivering",
      p_proof_image_url: null,
    });
    if (delivering.error) throw delivering.error;
    status = "delivering";
  }

  if (status === "delivering") {
    await ensureDemoPayosRemittance(deliveryId, shipper);
    const delivered = await shipper.client.rpc("update_delivery_status", {
      p_delivery_id: deliveryId,
      p_status: "delivered",
      p_note: "Demo order delivered successfully",
      p_proof_image_url: null,
    });
    if (delivered.error) throw delivered.error;
  }

  return orderId;
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
  if (existing.data) {
    return await ensureCompletedDeliveryState(existing.data.order_id as string, manager, shipper, batchId);
  }

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
  await ensureDemoPayosRemittance(deliveryId, shipper);

  const delivered = await shipper.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: "delivered",
    p_note: "Demo order delivered successfully",
    p_proof_image_url: null,
  });
  if (delivered.error) throw delivered.error;
  return orderId;
}

async function createDeliveryOrder(
  customer: SignedInUser,
  manager: SignedInUser,
  shipper: SignedInUser,
  targetStatus: "assigned" | "picked_up" | "delivering",
  note: string,
  productId: string,
  batchId: string,
) {
  const existing = await admin.from("orders").select("order_id")
    .eq("user_id", customer.userId)
    .eq("note", note)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.order_id as string;

  await addCartItem(customer, productId, batchId, 1, `Prepared for ${targetStatus}`);
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
  if (targetStatus === "assigned") return orderId;

  const deliveryId = assigned.data as string;
  const verified = await shipper.client.rpc("verify_delivery_batch", {
    p_delivery_id: deliveryId,
    p_batch_id: batchId,
  });
  if (verified.error) throw verified.error;
  const pickedUp = await shipper.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: "picked_up",
    p_note: "Batch verified and collected from the manager",
    p_proof_image_url: null,
  });
  if (pickedUp.error) throw pickedUp.error;
  if (targetStatus === "picked_up") return orderId;

  const delivering = await shipper.client.rpc("update_delivery_status", {
    p_delivery_id: deliveryId,
    p_status: "delivering",
    p_note: "Delivery is on the way to the customer",
    p_proof_image_url: null,
  });
  if (delivering.error) throw delivering.error;
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
await createDeliveryOrder(
  customer,
  manager,
  employee,
  "assigned",
  "Assigned delivery sample",
  "30000000-0000-0000-0000-000000000003",
  "40000000-0000-0000-0000-000000000003",
);
await createDeliveryOrder(
  customerLan,
  manager,
  secondEmployee,
  "picked_up",
  "Picked-up delivery sample",
  "30000000-0000-0000-0000-000000000006",
  "40000000-0000-0000-0000-000000000006",
);
await createDeliveryOrder(
  customer,
  manager,
  employee,
  "delivering",
  "Delivering order sample",
  "30000000-0000-0000-0000-000000000010",
  "40000000-0000-0000-0000-000000000010",
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
const thirdCompletedOrderId = await createCompletedOrder(
  customer,
  manager,
  secondEmployee,
  "Completed broccoli order",
  "30000000-0000-0000-0000-000000000011",
  "40000000-0000-0000-0000-000000000011",
);
const fourthCompletedOrderId = await createCompletedOrder(
  customerLan,
  manager,
  employee,
  "Completed rice order",
  "30000000-0000-0000-0000-000000000008",
  "40000000-0000-0000-0000-000000000008",
);
const fifthCompletedOrderId = await createCompletedOrder(
  customer,
  manager,
  secondEmployee,
  "Completed pomelo order",
  "30000000-0000-0000-0000-000000000015",
  "40000000-0000-0000-0000-000000000015",
);
await ensureCustomerContent(customer, completedOrderId);
await ensureCustomerContent(customerLan, secondCompletedOrderId, "30000000-0000-0000-0000-000000000009");
await ensureCustomerContent(customer, thirdCompletedOrderId, "30000000-0000-0000-0000-000000000011");
await ensureCustomerContent(customerLan, fourthCompletedOrderId, "30000000-0000-0000-0000-000000000008");
await ensureCustomerContent(customer, fifthCompletedOrderId, "30000000-0000-0000-0000-000000000015");
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

const reportSamples = [
  { status: "pending", type: "product_quality", description: "The vegetables arrived bruised and need quality review.", response: null },
  { status: "processing", type: "delivery", description: "The delivery arrived later than the selected time window.", response: "The delivery route is being reviewed." },
  { status: "resolved", type: "payment", description: "The payment was recorded twice in the order history.", response: "The duplicate record was corrected." },
  { status: "rejected", type: "traceability", description: "The customer requested a batch certificate that was already displayed.", response: "The traceability information was complete." },
  { status: "pending", type: "product_quality", description: "The product freshness did not match the listing description.", response: null },
] as const;
for (const [index, sample] of reportSamples.entries()) {
  const owner = index % 2 === 0 ? customer : customerLan;
  const orderId = index % 2 === 0 ? completedOrderId : secondCompletedOrderId;
  const existing = await admin.from("reports").select("report_id")
    .eq("user_id", owner.userId).eq("description", sample.description).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    const closed = sample.status === "resolved" || sample.status === "rejected";
    const inserted = await admin.from("reports").insert({
      user_id: owner.userId,
      order_id: orderId,
      product_id: index % 2 === 0
        ? "30000000-0000-0000-0000-000000000007"
        : "30000000-0000-0000-0000-000000000009",
      type: sample.type,
      description: sample.description,
      status: sample.status,
      response: sample.response,
      resolved_by: closed ? systemAdmin.userId : null,
      resolved_at: closed ? new Date().toISOString() : null,
    });
    if (inserted.error) throw inserted.error;
  }
}

const managerRoom = await customer.client.rpc("create_chat_room", {
  p_type: "customer_manager",
  p_other_user_id: manager.userId,
  p_order_id: null,
  p_product_id: null,
});
if (managerRoom.error) throw managerRoom.error;
const conversationMessages = [
  { sender_id: customer.userId, message: "Which Fresh Rescue products are available today?" },
  { sender_id: manager.userId, message: "Guava and sweet potato deals are currently available." },
  { sender_id: customer.userId, message: "Can I combine a Rescue deal with a coupon?" },
  { sender_id: manager.userId, message: "Yes, if the order meets the coupon minimum amount." },
  { sender_id: customer.userId, message: "Thank you, I will review the cart total." },
];
for (const item of conversationMessages) {
  const existing = await admin.from("chat_messages").select("message_id")
    .eq("room_id", managerRoom.data).eq("message", item.message).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    const inserted = await admin.from("chat_messages").insert({
      room_id: managerRoom.data,
      sender_id: item.sender_id,
      message: item.message,
    });
    if (inserted.error) throw inserted.error;
  }
}

const assistantSamples = [
  ["Show the cheapest vegetables", "Here are the lowest-priced available vegetables.", "cheapest"],
  ["Which products expire soon?", "These batches have the nearest expiry dates.", "expiring_soon"],
  ["Find Fresh Rescue deals", "These active Fresh Rescue deals are available.", "saving"],
  ["Show certified products", "These products include listed certificates.", "certified"],
  ["Find rice products", "ST25 Brown Rice matches your request.", "product:rice"],
];
for (const [question, answer, intent] of assistantSamples) {
  const existing = await admin.from("assistant_logs").select("log_id")
    .eq("user_id", customer.userId).eq("question", question).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    const inserted = await admin.from("assistant_logs").insert({
      user_id: customer.userId,
      question,
      answer,
      intent,
      recommended_product_ids: [],
    });
    if (inserted.error) throw inserted.error;
  }
}

const couponSamples = [
  { code: "HISTORY-EXPIRED", status: "expired", amount: 25000, remaining_amount: 25000, expires_at: new Date(Date.now() - 86400000).toISOString(), used_at: null, description: "Expired coupon example" },
  { code: "HISTORY-CANCELLED", status: "cancelled", amount: 30000, remaining_amount: 30000, expires_at: new Date(Date.now() + 86400000).toISOString(), used_at: null, description: "Cancelled coupon example" },
] as const;
for (const sample of couponSamples) {
  const inserted = await admin.from("coupons").upsert({
    user_id: customer.userId,
    source_order_id: null,
    coupon_type: "fixed_amount",
    min_order_amount: 0,
    ...sample,
  }, { onConflict: "code" });
  if (inserted.error) throw inserted.error;
}

const customerCarts = await admin.from("carts").select("cart_id,user_id")
  .in("user_id", [customer.userId, customerLan.userId]);
if (customerCarts.error) throw customerCarts.error;
const cartByUser = Object.fromEntries(customerCarts.data.map((cart) => [cart.user_id, cart.cart_id]));
const cartSamples = [
  [customer.userId, "30000000-0000-0000-0000-000000000001", "40000000-0000-0000-0000-000000000001"],
  [customer.userId, "30000000-0000-0000-0000-000000000002", "40000000-0000-0000-0000-000000000002"],
  [customer.userId, "30000000-0000-0000-0000-000000000003", "40000000-0000-0000-0000-000000000003"],
  [customerLan.userId, "30000000-0000-0000-0000-000000000004", "40000000-0000-0000-0000-000000000004"],
  [customerLan.userId, "30000000-0000-0000-0000-000000000005", "40000000-0000-0000-0000-000000000005"],
];
for (const [userId, productId, batchId] of cartSamples) {
  const existing = await admin.from("cart_items").select("cart_item_id")
    .eq("cart_id", cartByUser[userId]).eq("batch_id", batchId).maybeSingle();
  if (existing.error) throw existing.error;
  const values = {
    cart_id: cartByUser[userId],
    product_id: productId,
    batch_id: batchId,
    quantity: 1,
    note: "Saved for the next FreshTrace order",
  };
  const result = existing.data
    ? await admin.from("cart_items").update(values).eq("cart_item_id", existing.data.cart_item_id)
    : await admin.from("cart_items").insert(values);
  if (result.error) throw result.error;
}

const chatMessages = await admin.from("chat_messages").select("message_id,sender_id")
  .eq("room_id", managerRoom.data).order("created_at").limit(5);
if (chatMessages.error) throw chatMessages.error;
for (const [index, message] of chatMessages.data.entries()) {
  const reactingUser = message.sender_id === customer.userId ? manager.userId : customer.userId;
  const reaction = ["like", "love", "wow", "laugh", "sad"][index];
  const existing = await admin.from("chat_message_reactions").select("reaction_id")
    .eq("message_id", message.message_id).eq("user_id", reactingUser).maybeSingle();
  if (existing.error) throw existing.error;
  const result = existing.data
    ? await admin.from("chat_message_reactions").update({ reaction }).eq("reaction_id", existing.data.reaction_id)
    : await admin.from("chat_message_reactions").insert({
      message_id: message.message_id,
      user_id: reactingUser,
      reaction,
    });
  if (result.error) throw result.error;
}

const paymentSamples = await admin.from("payments").select("payment_id,amount")
  .order("created_at").limit(5);
if (paymentSamples.error) throw paymentSamples.error;
for (const [index, payment] of paymentSamples.data.entries()) {
  const statuses = ["pending", "paid", "cancelled", "failed", "paid"] as const;
  const requestStatus = statuses[index];
  const providerOrderCode = 9900001 + index;
  const existing = await admin.from("payos_requests").select("request_id")
    .eq("provider_order_code", providerOrderCode).maybeSingle();
  if (existing.error) throw existing.error;
  const values = {
    payment_id: payment.payment_id,
    purpose: "checkout",
    requested_by: index % 2 === 0 ? customer.userId : customerLan.userId,
    provider_order_code: providerOrderCode,
    amount: payment.amount,
    status: requestStatus,
    checkout_url: requestStatus === "pending" ? `https://pay.freshtrace.local/${providerOrderCode}` : null,
    qr_code: requestStatus === "pending" ? `FRESHTRACE-PAYOS-${providerOrderCode}` : null,
    transaction_id: requestStatus === "paid" ? `PAYOS-DEMO-${index + 1}` : null,
    paid_at: requestStatus === "paid" ? new Date().toISOString() : null,
    provider_payload: { source: "FreshTrace representative data", status: requestStatus },
  };
  const result = existing.data
    ? await admin.from("payos_requests").update(values).eq("request_id", existing.data.request_id)
    : await admin.from("payos_requests").insert(values);
  if (result.error) throw result.error;
}

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
