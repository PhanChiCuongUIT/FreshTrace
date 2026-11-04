import { createClient } from "npm:@supabase/supabase-js@2.107.0";
import { refreshDemoDates } from "./refresh-demo-data.ts";

const dryRun = Deno.args.includes("--dry-run");
if (!dryRun && !Deno.args.includes("--confirm-demo-data")) {
  throw new Error(
    "Use --dry-run, then --confirm-demo-data. Never renew real food expiry dates.",
  );
}
const envFile = Deno.args.find((arg) => !arg.startsWith("--")) ||
  ".env.production";
const values = Object.fromEntries(
  (await Deno.readTextFile(envFile)).split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
      const i = line.indexOf("=");
      return [
        line.slice(0, i),
        line.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
      ];
    }),
);
const url = values.VITE_SUPABASE_URL;
const key = values.VITE_SUPABASE_ANON_KEY;
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url) || !key) {
  throw new Error("Expected a hosted demo URL and public key in the env file.");
}
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const login = await client.auth.signInWithPassword({
  email: "manager@freshtrace.local",
  password: Deno.env.get("FRESHTRACE_DEMO_PASSWORD") || "FreshTrace!123",
});
if (login.error) {
  throw new Error(`Demo Manager login failed: ${login.error.message}`);
}
try {
  const profile = await client.from("users").select("status,roles(role_name)")
    .eq("auth_user_id", login.data.user!.id).single();
  const roles = profile.data?.roles as unknown as
    | { role_name: string }
    | Array<{ role_name: string }>;
  if (
    profile.error || profile.data?.status !== "active" ||
    (Array.isArray(roles) ? roles[0]?.role_name : roles?.role_name) !==
      "manager"
  ) {
    throw new Error("Expected the active seeded Manager; no records changed.");
  }
  const snapshot: Record<string, unknown> = {};
  for (
    const table of ["batches", "fresh_rescue_deals", "inventory", "prices"]
  ) {
    const result = await client.from(table).select("*");
    if (result.error) throw result.error;
    snapshot[table] = result.data;
  }
  if (!dryRun) {
    await Deno.mkdir("supabase/.temp", { recursive: true });
    const path = `supabase/.temp/cloud-demo-before-refresh-${Date.now()}.json`;
    await Deno.writeTextFile(
      path,
      JSON.stringify(
        { url, savedAt: new Date().toISOString(), ...snapshot },
        null,
        2,
      ),
      { createNew: true },
    );
    console.log(
      `Saved catalog-date snapshot to ${path}; this is not a full Cloud backup.`,
    );
  }
  await refreshDemoDates(client, url, dryRun);
  for (const table of ["inventory", "prices"]) {
    const result = await client.from(table).select("*");
    if (result.error) throw result.error;
    const stable = (rows: unknown) =>
      JSON.stringify(
        (rows as object[]).map((row) => JSON.stringify(row)).sort(),
      );
    if (stable(result.data) !== stable(snapshot[table])) {
      throw new Error(
        `${table} changed during maintenance. Inspect concurrent activity; no automatic rollback was attempted.`,
      );
    }
  }
  console.log(
    "Stock/prices unchanged. This uses normal Manager permissions and does NOT install the monthly maintenance job.",
  );
} finally {
  await client.auth.signOut({ scope: "local" });
}
