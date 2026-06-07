import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { requireProfile } from "../_shared/supabase.ts";

type Body = { folder: "products" | "certificates" | "deliveries" | "avatars" | "chat" };

async function sha1(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request);
    const { folder } = await readJson<Body>(request);
    const permissions: Record<string, string[]> = {
      products: ["admin", "manager"],
      certificates: ["admin", "manager"],
      deliveries: ["admin", "manager", "employee"],
      avatars: ["admin", "manager", "employee", "customer"],
      chat: ["admin", "manager", "employee", "customer"],
    };
    if (!permissions[folder]?.includes(profile.role)) throw new HttpError(403, "Folder is not allowed");

    const timestamp = Math.floor(Date.now() / 1000);
    const cloudFolder = `freshtrace/${folder}`;
    const params = `folder=${cloudFolder}&timestamp=${timestamp}`;
    const signature = await sha1(params + Deno.env.get("CLOUDINARY_API_SECRET")!);
    return json(request, {
      cloudName: Deno.env.get("CLOUDINARY_CLOUD_NAME"),
      apiKey: Deno.env.get("CLOUDINARY_API_KEY"),
      folder: cloudFolder,
      timestamp,
      signature,
    });
  } catch (error) {
    return handleError(request, error);
  }
});
