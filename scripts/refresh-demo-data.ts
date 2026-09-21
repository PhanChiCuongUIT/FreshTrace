import { createClient } from "npm:@supabase/supabase-js@2.107.0";

// Fixed demo fixtures only: never extend the shelf life of real inventory.
const offsets = [
  [-1, 5], [-2, 2], [-2, 6], [-3, 2], [-1, 3], [0, 4], [-1, 7],
  [-30, 300], [-2, 8], [0, 4], [-1, 6], [-2, 2], [-3, 2], [0, 1],
  [-4, 12], [-1, 7],
];
const batchIds = offsets.map((_, index) =>
  `40000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`
);
const baseUrl = Deno.args[0];
const key = Deno.args[1]?.startsWith("--") ? undefined : Deno.args[1];
const serviceKey = key || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const dryRun = Deno.args.includes("--dry-run");
if (!baseUrl || !serviceKey) throw new Error("Supabase URL and service-role key are required.");
const supabase = createClient(baseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const today = new Date().toISOString().slice(0, 10);
function date(offset: number) {
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}
async function checked<T>(label: string, result: { data: T; error: unknown }) {
  if (result.error) throw new Error(`${label}: ${JSON.stringify(result.error)}`);
  return result.data;
}

const batches = await checked("Read batches", await supabase.from("batches")
  .select("batch_id,product_id,status,harvest_date,expire_date").in("batch_id", batchIds)) ?? [];
const inventory = await checked("Read inventory", await supabase.from("inventory")
  .select("batch_id,quantity_available,quantity_reserved").in("batch_id", batchIds)) ?? [];
const deals = await checked("Read rescue deals", await supabase.from("fresh_rescue_deals")
  .select("deal_id,batch_id,status,rescue_price,start_at,end_at")
  .in("deal_id", [2, 3, 4, 5, 6].map((id) => `50000000-0000-0000-0000-${String(id).padStart(12, "0")}`))) ?? [];
const prices = await checked("Read current prices", await supabase.from("prices")
  .select("product_id,batch_id,price,price_type,start_date")
  .in("price_type", ["normal", "promotion"]).lte("start_date", today)
  .or(`end_date.is.null,end_date.gte.${today}`)
  .in("product_id", batches.map((b) => b.product_id))) ?? [];

const warnings: string[] = [];
const batchPlan: Array<{ id: string; harvest_date: string; expire_date: string }> = [];
for (const batch of batches) {
  if (batch.status === "locked") {
    warnings.push(`Skipped locked batch ${batch.batch_id}`);
    continue;
  }
  const [harvest, expiry] = offsets[batchIds.indexOf(batch.batch_id)];
  if (batch.harvest_date !== date(harvest) || batch.expire_date !== date(expiry)) {
    batchPlan.push({ id: batch.batch_id, harvest_date: date(harvest), expire_date: date(expiry) });
  }
}
const rescuePlan: Array<{ id: string; status: string; start_at: string; end_at: string }> = [];
for (const deal of deals) {
  const batch = batches.find((b) => b.batch_id === deal.batch_id);
  if (!batch || batch.status === "locked" || deal.status === "inactive") continue;
  const stock = inventory.find((i) => i.batch_id === deal.batch_id);
  const available = Number(stock?.quantity_available ?? 0) - Number(stock?.quantity_reserved ?? 0);
  const expiredFixture = deal.deal_id.endsWith("003");
  const status = expiredFixture ? "expired" : available > 0 ? "active" : "sold_out";
  if (status === "active") {
    const candidates = prices.filter((p) => p.product_id === batch.product_id &&
      (p.batch_id === batch.batch_id || p.batch_id === null));
    candidates.sort((a, b) => Number(b.batch_id === batch.batch_id) - Number(a.batch_id === batch.batch_id) ||
      Number(b.price_type === "promotion") - Number(a.price_type === "promotion") ||
      b.start_date.localeCompare(a.start_date));
    if (!candidates[0] || Number(candidates[0].price) <= Number(deal.rescue_price)) {
      warnings.push(`Skipped rescue ${deal.deal_id}: set a valid current catalog price first.`);
      continue;
    }
  }
  const start_at = `${date(expiredFixture ? -3 : 0)}T00:00:00.000Z`;
  const end_at = `${date(expiredFixture ? -1 : 1)}T12:00:00.000Z`;
  if (deal.status !== status || Date.parse(deal.start_at) !== Date.parse(start_at) ||
    Date.parse(deal.end_at) !== Date.parse(end_at)) {
    rescuePlan.push({ id: deal.deal_id, status, start_at, end_at });
  }
}
if (batches.length < batchIds.length) warnings.push(`${batchIds.length - batches.length} demo batches are missing; refresh does not create them.`);
console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "refresh", baseUrl, effectiveDate: today,
  batches: batchPlan, rescueDeals: rescuePlan, warnings,
  preserved: ["users/passwords", "inventory quantities", "price history", "orders/payments", "coupons", "messages"],
}, null, 2));
if (!dryRun) {
  // API updates are individually atomic. On failure rerun to finish remaining
  // fixtures; never restore stock or rewrite financial history to recover.
  for (const { id, ...values } of batchPlan) {
    const rows = await checked(`Refresh batch ${id}`, await supabase.from("batches")
      .update(values).eq("batch_id", id).neq("status", "locked").select("batch_id"));
    if (rows?.length !== 1) throw new Error(`Batch ${id} changed concurrently; rerun dry-run.`);
  }
  for (const { id, ...values } of rescuePlan) {
    const rows = await checked(`Refresh rescue ${id}`, await supabase.from("fresh_rescue_deals")
      .update(values).eq("deal_id", id).neq("status", "inactive").select("deal_id"));
    if (rows?.length !== 1) throw new Error(`Rescue ${id} changed concurrently; rerun dry-run.`);
  }
  console.log("Demo date refresh complete. Stock and financial history were not rewritten.");
}
