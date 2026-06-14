type Env = Record<string, string>;

function readEnv(text: string): Env {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const value = line.trim();
    if (!value || value.startsWith("#") || !value.includes("=")) return [];
    const [key, ...rest] = value.split("=");
    return [[key.trim(), rest.join("=").trim().replace(/^['"]|['"]$/g, "")]];
  }));
}

async function sha1(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const cloudinary = readEnv(await Deno.readTextFile("supabase/.env.local"));
const frontend = readEnv(await Deno.readTextFile("frontend/.env.local"));
const cloudName = cloudinary.CLOUDINARY_CLOUD_NAME;
const apiKey = cloudinary.CLOUDINARY_API_KEY;
const apiSecret = cloudinary.CLOUDINARY_API_SECRET;
const supabaseUrl = frontend.VITE_SUPABASE_URL;
const publishableKey = frontend.VITE_SUPABASE_ANON_KEY ?? frontend.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary credentials are missing in supabase/.env.local");
if (!supabaseUrl || !publishableKey) throw new Error("Supabase URL/key are missing in frontend/.env.local");

const catalogResponse = await fetch(`${supabaseUrl}/rest/v1/products?select=name,image_url&status=eq.active&order=name`, {
  headers: {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
  },
});
if (!catalogResponse.ok) throw new Error(`Could not load products: ${await catalogResponse.text()}`);

const products = await catalogResponse.json() as Array<{ name: string; image_url: string | null }>;
const sourceOverrides: Record<string, string> = {
  "Purple Sweet Potato": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=900&q=80",
};
const mapping: Record<string, string> = {};
for (const product of products) {
  const productName = product.name;
  if (!product.image_url) continue;
  if (product.image_url.includes("res.cloudinary.com")) {
    mapping[productName] = product.image_url;
    continue;
  }

  const source = await fetch(sourceOverrides[productName] ?? product.image_url);
  if (!source.ok) {
    console.warn(`Skipped ${productName}: source returned ${source.status}`);
    continue;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "freshtrace/products";
  const publicId = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const signature = await sha1(`folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);
  const form = new FormData();
  form.append("file", new Blob([await source.arrayBuffer()], { type: source.headers.get("content-type") ?? "image/jpeg" }), `${publicId}.jpg`);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("overwrite", "true");
  form.append("signature", signature);

  const uploaded = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
  const result = await uploaded.json();
  if (!uploaded.ok || !result.secure_url) throw new Error(`Cloudinary upload failed for ${productName}: ${result.error?.message ?? uploaded.status}`);
  mapping[productName] = result.secure_url;
  console.log(`Uploaded ${productName}`);
}

await Deno.writeTextFile("frontend/src/generated/productImages.json", `${JSON.stringify(mapping, null, 2)}\n`);
console.log(`Saved ${Object.keys(mapping).length} Cloudinary product images without changing the database.`);
