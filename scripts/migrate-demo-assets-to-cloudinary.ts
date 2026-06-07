import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const envText = await Deno.readTextFile("frontend/.env.local");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const [key, ...value] = line.split("=");
  return [key.trim(), value.join("=").trim()];
}));
const url = env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!key) throw new Error("frontend/.env.local must define VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY");

async function signIn(email: string) {
  const client = createClient(url, key);
  const result = await client.auth.signInWithPassword({ email, password: "FreshTrace!123" });
  if (result.error) throw result.error;
  return client;
}

async function upload(client: SupabaseClient, bytes: Uint8Array, name: string, type: string, folder: string, resourceType = "image") {
  const signed = await client.functions.invoke("sign-cloudinary-upload", { body: { folder } });
  if (signed.error) throw signed.error;
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  form.append("api_key", signed.data.apiKey);
  form.append("timestamp", String(signed.data.timestamp));
  form.append("signature", signed.data.signature);
  form.append("folder", signed.data.folder);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${signed.data.cloudName}/${resourceType}/upload`, {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok || !payload.secure_url) throw new Error(payload.error?.message ?? "Cloudinary upload failed");
  return payload.secure_url as string;
}

async function fetchBytes(source: string) {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not download ${source}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const manager = await signIn("manager@freshtrace.local");
const products = await manager.from("products").select("product_id,name,image_url").order("name");
if (products.error) throw products.error;
for (const product of products.data) {
  if (product.image_url?.includes("res.cloudinary.com")) continue;
  const source = product.image_url || `https://placehold.co/900x600/png?text=${encodeURIComponent(product.name)}`;
  const bytes = await fetchBytes(source);
  const imageUrl = await upload(manager, bytes, `${product.product_id}.jpg`, "image/jpeg", "products");
  const updated = await manager.from("products").update({ image_url: imageUrl }).eq("product_id", product.product_id);
  if (updated.error) throw updated.error;
  console.log(`product ${product.name}`);
}

const accounts = [
  ["admin@freshtrace.local", "AD"],
  ["manager@freshtrace.local", "MN"],
  ["manager.hcm@freshtrace.local", "HM"],
  ["shipper@freshtrace.local", "SP"],
  ["shipper.linh@freshtrace.local", "SL"],
  ["customer@freshtrace.local", "CU"],
  ["customer.lan@freshtrace.local", "LA"],
] as const;
for (const [email, initials] of accounts) {
  const client = await signIn(email);
  const profile = await client.from("users").select("user_id,avatar_url").eq("email", email).single();
  if (profile.error) throw profile.error;
  if (profile.data.avatar_url?.includes("res.cloudinary.com")) continue;
  const bytes = await fetchBytes(`https://ui-avatars.com/api/?name=${initials}&size=256&background=1f7a4f&color=ffffff&format=png`);
  const avatarUrl = await upload(client, bytes, `${profile.data.user_id}.png`, "image/png", "avatars");
  const updated = await client.from("users").update({ avatar_url: avatarUrl }).eq("user_id", profile.data.user_id);
  if (updated.error) throw updated.error;
  console.log(`avatar ${email}`);
}

const customer = await signIn("customer@freshtrace.local");
const room = await customer.from("chat_room_members").select("room_id").limit(1).maybeSingle();
if (room.error) throw room.error;
if (room.data) {
  const profile = await customer.from("users").select("user_id").eq("email", "customer@freshtrace.local").single();
  if (profile.error) throw profile.error;
  const existing = await customer.from("chat_messages").select("message_id")
    .eq("sender_id", profile.data.user_id).eq("message", "Cloudinary attachment verification").limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) {
    const content = new TextEncoder().encode("FreshTrace demo attachment stored on Cloudinary.");
    const attachmentUrl = await upload(customer, content, "freshtrace-demo.txt", "text/plain", "chat", "auto");
    const inserted = await customer.from("chat_messages").insert({
      room_id: room.data.room_id,
      sender_id: profile.data.user_id,
      message: "Cloudinary attachment verification",
      attachment_url: attachmentUrl,
      attachment_name: "freshtrace-demo.txt",
      attachment_type: "text/plain",
      attachment_size: content.byteLength,
    });
    if (inserted.error) throw inserted.error;
    console.log("chat attachment");
  }
}

const shipper = await signIn("shipper@freshtrace.local");
const delivery = await shipper.from("deliveries").select("delivery_id,proof_image_url").eq("status", "delivered").limit(1).maybeSingle();
if (delivery.error) throw delivery.error;
if (delivery.data && (
  !delivery.data.proof_image_url?.includes("res.cloudinary.com")
  || delivery.data.proof_image_url.includes("res.cloudinary.com/demo/")
  || delivery.data.proof_image_url.includes("freshtrace-demo-proof")
)) {
  const bytes = await fetchBytes("https://placehold.co/900x600/png?text=FreshTrace+Delivery+Proof");
  const proofUrl = await upload(shipper, bytes, `${delivery.data.delivery_id}.png`, "image/png", "deliveries");
  const replaced = await shipper.rpc("replace_delivery_proof", {
    p_delivery_id: delivery.data.delivery_id,
    p_proof_image_url: proofUrl,
  });
  if (replaced.error) throw replaced.error;
  console.log("delivery proof");
}

console.log("Cloudinary demo assets are ready.");
