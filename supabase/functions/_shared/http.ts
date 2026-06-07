import { corsHeaders } from "./cors.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

export function handleError(request: Request, error: unknown): Response {
  console.error(error);
  if (error instanceof HttpError) {
    return json(request, { error: error.message }, error.status);
  }
  return json(request, { error: "Internal server error" }, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
