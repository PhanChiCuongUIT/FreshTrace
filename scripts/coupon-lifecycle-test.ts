import { createClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!publishableKey || !secretKey) {
  throw new Error("Usage: deno run --allow-net coupon-lifecycle-test.ts <url> <publishable-key> <secret-key>");
}

const service = createClient(baseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(baseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = Date.now();
const email = `coupon.${suffix}@freshtrace.local`;
const password = "FreshTrace!123";

const created = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { name: "Coupon lifecycle test" },
});
if (created.error || !created.data.user) throw created.error ?? new Error("Could not create coupon test user");

const signedIn = await client.auth.signInWithPassword({ email, password });
if (signedIn.error) throw signedIn.error;

const profile = await client.from("users").select("user_id").single();
if (profile.error) throw profile.error;
const cart = await client.from("carts").select("cart_id").single();
if (cart.error) throw cart.error;
const welcome = await client.from("coupons")
  .select("coupon_id,code,amount,remaining_amount,status")
  .eq("milestone_key", "welcome_freeship_1")
  .single();
if (welcome.error) throw welcome.error;

const cartItem = await client.from("cart_items").insert({
  cart_id: cart.data.cart_id,
  product_id: "30000000-0000-0000-0000-000000000001",
  batch_id: "40000000-0000-0000-0000-000000000001",
  quantity: 5,
});
if (cartItem.error) throw cartItem.error;

const checkout = await client.rpc("checkout_cart", {
  p_delivery_address: "123 Coupon Lifecycle Street",
  p_payment_method: "cod",
  p_delivery_fee: 20000,
  p_note: "Coupon lifecycle verification",
  p_coupon_code: welcome.data.code,
});
if (checkout.error) throw checkout.error;
const orderId = checkout.data as string;

const consumed = await client.from("coupons")
  .select("remaining_amount,status,used_order_id")
  .eq("coupon_id", welcome.data.coupon_id)
  .single();
if (consumed.error) throw consumed.error;
if (Number(consumed.data.remaining_amount) !== 0
  || consumed.data.status !== "used"
  || consumed.data.used_order_id !== orderId) {
  throw new Error("Coupon was not marked used after its full balance was consumed");
}
const checkoutCoupons = await client.from("coupons").select("coupon_id")
  .eq("status", "active").gt("remaining_amount", 0);
if (checkoutCoupons.error) throw checkoutCoupons.error;
if (checkoutCoupons.data.some((coupon) => coupon.coupon_id === welcome.data.coupon_id)) {
  throw new Error("Used coupon was still returned as checkout-eligible");
}

const cancelled = await client.rpc("cancel_order", {
  p_order_id: orderId,
  p_reason: "Coupon restoration verification",
});
if (cancelled.error) throw cancelled.error;
const restored = await client.from("coupons")
  .select("remaining_amount,status,used_order_id")
  .eq("coupon_id", welcome.data.coupon_id)
  .single();
if (restored.error) throw restored.error;
if (Number(restored.data.remaining_amount) !== Number(welcome.data.amount)
  || restored.data.status !== "active"
  || restored.data.used_order_id !== null) {
  throw new Error("Coupon balance was not restored after pending order cancellation");
}

console.log("PASS coupon: full use hides coupon from checkout");
console.log("PASS coupon: pending cancellation restores a fully used coupon");
