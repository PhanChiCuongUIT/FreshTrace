function scalar(value: unknown): string {
  if (value === null || value === undefined || value === "null" || value === "undefined") return "";
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
      }
      return entry;
    }));
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function sortedQuery(data: Record<string, unknown>): string {
  return Object.keys(data).sort().map((key) => `${key}=${scalar(data[key])}`).join("&");
}

export async function hmacSha256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyHmac(data: Record<string, unknown>, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSha256(sortedQuery(data), secret);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}
