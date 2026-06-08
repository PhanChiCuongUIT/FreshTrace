const envText = await Deno.readTextFile("supabase/.env.local");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line.includes("=") && !line.trim().startsWith("#")).map((line) => {
  const [key, ...value] = line.split("=");
  return [key.trim(), value.join("=").trim().replace(/^['"]|['"]$/g, "")];
}));

const cloudName = env.CLOUDINARY_CLOUD_NAME;
const apiKey = env.CLOUDINARY_API_KEY;
const apiSecret = env.CLOUDINARY_API_SECRET;
if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary credentials are missing in supabase/.env.local");

async function sha1(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const timestamp = Math.floor(Date.now() / 1000);
const folder = "freshtrace/email";
const publicId = "logo-freshtrace";
const params = `folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}`;
const signature = await sha1(params + apiSecret);
const file = await Deno.readFile("frontend/public/Logo-FreshTrace.png");

const form = new FormData();
form.append("file", new File([file], "Logo-FreshTrace.png", { type: "image/png" }));
form.append("api_key", apiKey);
form.append("timestamp", String(timestamp));
form.append("folder", folder);
form.append("public_id", publicId);
form.append("overwrite", "true");
form.append("signature", signature);

const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
  method: "POST",
  body: form,
});
const payload = await response.json();
if (!response.ok || !payload.secure_url) {
  throw new Error(payload.error?.message ?? "Cloudinary upload failed");
}

console.log(payload.secure_url);
