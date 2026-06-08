const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const apiKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!apiKey || !secretKey) throw new Error("Usage: deno run --allow-net scripts/smoke-test.ts <url> <publishable-key> <secret-key>");

const email = `smoke.${Date.now()}@freshtrace.local`;
const password = "FreshTrace!123";

async function request(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(body)}`);
  return body;
}

const created = await fetch(`${baseUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "FreshTrace Smoke Test" } }),
});
if (!created.ok) throw new Error(`Could not create confirmed smoke user: ${await created.text()}`);
const auth = await request("/auth/v1/token?grant_type=password", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});
const token = auth.access_token;
if (!token) throw new Error("Signup did not return an access token");

// Docker Desktop on Windows can have a clock skew between Auth and PostgREST.
await new Promise((resolve) => setTimeout(resolve, 10000));

const [profiles, carts, products] = await Promise.all([
  request("/rest/v1/users?select=user_id,name,email,roles(role_name)", {}, token),
  request("/rest/v1/carts?select=cart_id,user_id", {}, token),
  request("/rest/v1/products?select=product_id,name&status=eq.active", {}, token),
]);
if (profiles.length !== 1 || profiles[0].roles.role_name !== "customer") {
  throw new Error("Profile trigger or customer role failed");
}
if (carts.length !== 1) throw new Error("Cart trigger failed");
if (products.length < 1) throw new Error("Catalog seed or public RLS failed");

await request("/rest/v1/cart_items", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    cart_id: carts[0].cart_id,
    product_id: "30000000-0000-0000-0000-000000000001",
    batch_id: "40000000-0000-0000-0000-000000000001",
    quantity: 2,
    note: "Smoke test",
  }),
}, token);

const orderId = await request("/rest/v1/rpc/checkout_cart", {
  method: "POST",
  body: JSON.stringify({
    p_delivery_address: "123 Nguyen Hue, District 1",
    p_payment_method: "cod",
    p_delivery_fee: 20000,
    p_note: "Smoke test order",
  }),
}, token);
const orders = await request(
  `/rest/v1/orders?order_id=eq.${orderId}&select=order_id,status,total_amount,order_items(quantity,price),payments(method,status)`,
  {},
  token,
);
if (orders.length !== 1 || orders[0].status !== "pending") throw new Error("Checkout failed");

console.log(JSON.stringify({
  ok: true,
  email,
  profileRole: profiles[0].roles.role_name,
  productCount: products.length,
  orderId,
  orderStatus: orders[0].status,
}, null, 2));
