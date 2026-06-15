const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return true;
  return allowedOrigins.some((allowed) => {
    if (!allowed.includes("*")) return false;
    const pattern = `^${escapeRegExp(allowed).replaceAll("\\*", ".*")}$`;
    return new RegExp(pattern).test(origin);
  });
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? allowedOrigins[0] ?? "*";
  const allowedOrigin = isAllowedOrigin(origin)
    ? origin
    : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-edge-function-secret",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

export function preflight(request: Request): Response | null {
  return request.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders(request) })
    : null;
}
