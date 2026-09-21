import { createClient } from "npm:@supabase/supabase-js@2.107.0";

// No business-data mutations: sign-in/out may still create normal Auth audit logs.
const envFile = Deno.args[0] || "frontend/.env.local";
const values = Object.fromEntries((await Deno.readTextFile(envFile)).split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => {
    const i = line.indexOf("=");
    return [line.slice(0, i), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const url = Deno.args[1] || values.VITE_SUPABASE_URL;
const key = values.VITE_SUPABASE_ANON_KEY;
const site = Deno.args[2] || values.VITE_SITE_URL;
if (!url || !key || !site) throw new Error("Supabase URL, public key and site URL are required.");
const password = Deno.env.get("FRESHTRACE_DEMO_PASSWORD") || "FreshTrace!123";
const headers = { apikey: key, Origin: new URL(site).origin };
let failures = 0;
async function check(label: string, action: () => Promise<unknown>) {
  try { const result = await action(); console.log(`PASS ${label}${result === undefined ? "" : `: ${result}`}`); }
  catch (error) {
    failures++;
    // Do not dump headers, tokens, profile data or request payloads.
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : "request failed"}`);
  }
}
async function rows(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return Array.isArray(data) ? data.length : data ? 1 : 0;
}
await check("website /login", async () => {
  const r = await fetch(`${site.replace(/\/$/, "")}/login`);
  if (!r.ok || !(await r.text()).includes('id="root"')) throw new Error(`Unexpected app response HTTP ${r.status}`);
  return r.status;
});
await check("Auth health", async () => {
  const r = await fetch(`${url}/auth/v1/health`, { headers });
  await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
});
await check("Edge CORS preflight", async () => {
  const r = await fetch(`${url}/functions/v1/account-status`, {
    method: "OPTIONS", headers: { Origin: new URL(site).origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "apikey,content-type,authorization" },
  });
  await r.text();
  const allowed = r.headers.get("access-control-allow-origin");
  if (!r.ok || (allowed !== new URL(site).origin && allowed !== "*")) throw new Error(`Origin not allowed (HTTP ${r.status})`);
});
await check("wrong password rejected", async () => {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "customer@freshtrace.local", password: "intentionally-wrong-password" }),
  });
  const body = await r.json();
  if (r.ok || (body.error_code ?? body.code) !== "invalid_credentials") throw new Error(`Expected invalid_credentials, received HTTP ${r.status}`);
  return "invalid_credentials (translated by the updated frontend)";
});

for (const [role, email] of [["customer", "customer@freshtrace.local"], ["manager", "manager@freshtrace.local"], ["employee", "shipper@freshtrace.local"], ["admin", "admin@freshtrace.local"]]) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await check(`${role} login and screen queries`, async () => {
    const account = await fetch(`${url}/functions/v1/account-status`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const accountBody = await account.json();
    if (!account.ok || accountBody.allowed !== true) throw new Error(`Account status check failed HTTP ${account.status}`);
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw new Error(`Sign-in: ${login.error.message}`);
    try {
      const profile = await client.from("users").select("user_id,roles(role_name)").eq("auth_user_id", login.data.user!.id).single();
      if (profile.error) throw profile.error;
      const id = profile.data.user_id;
      const relation = profile.data.roles as unknown as { role_name: string } | Array<{ role_name: string }>;
      if ((Array.isArray(relation) ? relation[0]?.role_name : relation?.role_name) !== role) throw new Error("Unexpected demo role");
      const counts: Record<string, number> = {};
      if (role === "customer") {
        counts.catalog = await rows("catalog", client.rpc("search_products", { p_query: null, p_category_id: null, p_certificate: null, p_max_price: null, p_rescue_only: false, p_limit: 50, p_offset: 0 }));
        counts.orders = await rows("orders", client.from("orders").select("order_id,order_items(product_name,batches(batch_code)),payments(method,status),deliveries(status),order_tracking(status)").eq("user_id", id));
        counts.cart = await rows("cart", client.from("carts").select("cart_id,cart_items(quantity)").eq("user_id", id));
        counts.coupons = await rows("coupons", client.from("coupons").select("coupon_id,remaining_amount,expires_at").eq("user_id", id));
      } else if (role === "employee") {
        counts.deliveries = await rows("deliveries", client.from("deliveries").select("delivery_id,status,delivery_batch_checks(batch_id,matched,checked_at),delivery_payment_collections(method,status,remittance_status),orders(order_id,users(name,phone),payments(method,status),order_items(product_name,batches(batch_id,batch_code)))").eq("employee_id", id));
      } else if (role === "manager") {
        for (const table of ["suppliers", "categories", "products", "batches", "prices", "fresh_rescue_deals", "inventory", "inventory_transactions"]) {
          counts[table] = await rows(table, client.from(table).select("*").limit(100));
        }
        counts.operations = await rows("operations", client.from("orders").select("order_id,users(name,phone),deliveries(employee_id,status),order_tracking(status),order_items(product_name,products(suppliers(name)))"));
      } else {
        counts.users = await rows("users", client.from("users").select("user_id,roles(role_name)"));
        counts.orders = await rows("monitor orders", client.from("orders").select("order_id,status,users(name)"));
        counts.deliveries = await rows("monitor deliveries", client.from("deliveries").select("delivery_id,status,pickup_time,delivery_time,orders(order_code),users(name)"));
        counts.inventory = await rows("monitor inventory", client.from("inventory").select("inventory_id,quantity_available,quantity_reserved,batches(batch_code,status,expire_date,products(name))"));
        counts.finance = await rows("finance", client.from("payments").select("payment_id,method,status,amount,created_at,orders(order_code)"));
        counts.reports = await rows("reports", client.from("reports").select("report_id,status"));
      }
      counts.notifications = await rows("notifications", client.from("notifications").select("notification_id,is_read").eq("user_id", id));
      console.log(JSON.stringify({ role, counts }));
    } finally { await client.auth.signOut({ scope: "local" }); }
  });
}
await check("public batch trace", async () => {
  const r = await fetch(`${url}/functions/v1/trace-batch?code=FT-SPINACH-001`, { headers });
  const body = await r.json();
  if (!r.ok || body.data?.batch_code !== "FT-SPINACH-001") throw new Error(`Trace failed HTTP ${r.status}`);
});
if (failures) throw new Error(`${failures} checks failed. No orders, payments, profiles or catalog records were changed.`);
console.log("Read-only checks passed. This is not a browser/UI or live payment test.");
