import { createClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0];
const serviceRoleKey = Deno.args[1];
const preSeed = Deno.args.includes("--pre-seed");

if (!baseUrl || !serviceRoleKey) {
  throw new Error(
    "Usage: deno run --allow-net scripts/refresh-demo-data.ts <supabase-url> <service-role-key>",
  );
}

const supabase = createClient(baseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type DemoBatch = {
  batchId: string;
  productId: string;
  harvestOffset: number;
  expiryOffset: number;
  baselineAvailable: number;
};

type InventoryRow = {
  batch_id: string;
  quantity_reserved: number | null;
};

const demoBatches: DemoBatch[] = [
  ["001", "001", -1, 5, 50],
  ["002", "002", -2, 2, 80],
  ["003", "003", -2, 6, 45],
  ["004", "004", -3, 2, 55],
  ["005", "005", -1, 3, 35],
  ["006", "006", 0, 4, 60],
  ["007", "007", -1, 7, 70],
  ["008", "008", -30, 300, 100],
  ["009", "009", -2, 8, 48],
  ["010", "010", 0, 4, 40],
  ["011", "011", -1, 6, 65],
  ["012", "012", -2, 2, 75],
  ["013", "013", -3, 2, 55],
  ["014", "014", 0, 1, 45],
  ["015", "015", -4, 12, 50],
  ["016", "016", -1, 7, 35],
].map(([batchSuffix, productSuffix, harvestOffset, expiryOffset, baselineAvailable]) => ({
  batchId: `40000000-0000-0000-0000-000000000${batchSuffix}`,
  productId: `30000000-0000-0000-0000-000000000${productSuffix}`,
  harvestOffset: harvestOffset as number,
  expiryOffset: expiryOffset as number,
  baselineAvailable: baselineAvailable as number,
}));

const demoPrices = new Map([
  ["001", 25000],
  ["002", 32000],
  ["003", 85000],
  ["004", 42000],
  ["005", 38000],
  ["006", 18000],
  ["007", 49000],
  ["008", 145000],
  ["009", 78000],
  ["010", 95000],
  ["011", 36000],
  ["012", 28000],
  ["013", 34000],
  ["014", 16000],
  ["015", 72000],
  ["016", 285000],
]);

function dateWithOffset(offset: number): string {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(utcMidnight);
  target.setUTCDate(target.getUTCDate() + offset);
  return target.toISOString().slice(0, 10);
}

function isoHoursFromNow(hours: number): string {
  const target = new Date(Date.now() + hours * 60 * 60 * 1000);
  return target.toISOString();
}

async function assertOk<T>(label: string, result: { data: T; error: unknown }) {
  if (result.error) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

async function refreshBatches() {
  let updated = 0;
  for (const batch of demoBatches) {
    const result = await supabase.from("batches")
      .update({
        harvest_date: dateWithOffset(batch.harvestOffset),
        expire_date: dateWithOffset(batch.expiryOffset),
        status: "available",
        updated_at: new Date().toISOString(),
      })
      .eq("batch_id", batch.batchId)
      .neq("status", "locked")
      .select("batch_id");
    const rows = await assertOk(`${batch.batchId} batch refresh`, result);
    updated += rows?.length ?? 0;
  }
  return updated;
}

async function refreshInventory() {
  const batchIds = demoBatches.map((batch) => batch.batchId);
  const inventory = await assertOk(
    "inventory lookup",
    await supabase.from("inventory")
      .select("batch_id,quantity_reserved")
      .in("batch_id", batchIds),
  ) as InventoryRow[];

  const reservedByBatch = new Map(
    inventory.map((row) => [row.batch_id, Number(row.quantity_reserved ?? 0)]),
  );

  let updated = 0;
  for (const batch of demoBatches) {
    const reserved = reservedByBatch.get(batch.batchId) ?? 0;
    const quantityAvailable = !preSeed && batch.batchId.endsWith("014")
      ? reserved
      : Math.max(batch.baselineAvailable, reserved + 20);

    const result = await supabase.from("inventory")
      .update({
        quantity_available: quantityAvailable,
        last_updated: new Date().toISOString(),
      })
      .eq("batch_id", batch.batchId)
      .select("inventory_id");
    const rows = await assertOk(`${batch.batchId} inventory refresh`, result);
    updated += rows?.length ?? 0;
  }
  return updated;
}

async function refreshPrices() {
  let updated = 0;
  for (const batch of demoBatches) {
    const suffix = batch.batchId.slice(-3);
    const price = demoPrices.get(suffix);
    if (!price) continue;

    const result = await supabase.from("prices")
      .update({
        price,
        price_type: "normal",
        start_date: dateWithOffset(0),
        end_date: null,
      })
      .eq("product_id", batch.productId)
      .eq("batch_id", batch.batchId)
      .eq("price_type", "normal")
      .select("price_id");
    const rows = await assertOk(`${batch.batchId} price refresh`, result);
    updated += rows?.length ?? 0;

    const prices = await assertOk(
      `${batch.batchId} price duplicate lookup`,
      await supabase.from("prices")
        .select("price_id,created_at")
        .eq("product_id", batch.productId)
        .eq("batch_id", batch.batchId)
        .eq("price_type", "normal")
        .order("created_at", { ascending: true }),
    ) as Array<{ price_id: string; created_at: string }>;

    const duplicateIds = prices.slice(1).map((row) => row.price_id);
    if (duplicateIds.length > 0) {
      await assertOk(
        `${batch.batchId} price duplicate cleanup`,
        await supabase.from("prices").delete().in("price_id", duplicateIds),
      );
      updated -= duplicateIds.length;
    }
  }
  return updated;
}

async function refreshRescueDeals() {
  const rescueUpdates = [
    {
      deal_id: "50000000-0000-0000-0000-000000000002",
      start_at: isoHoursFromNow(-72),
      end_at: isoHoursFromNow(36),
      status: "inactive",
    },
    {
      deal_id: "50000000-0000-0000-0000-000000000003",
      start_at: isoHoursFromNow(-72),
      end_at: isoHoursFromNow(-24),
      status: "expired",
    },
    {
      deal_id: "50000000-0000-0000-0000-000000000004",
      start_at: isoHoursFromNow(-1),
      end_at: isoHoursFromNow(30),
      status: "active",
    },
    {
      deal_id: "50000000-0000-0000-0000-000000000005",
      start_at: isoHoursFromNow(-1),
      end_at: isoHoursFromNow(30),
      status: "active",
    },
    {
      deal_id: "50000000-0000-0000-0000-000000000006",
      start_at: isoHoursFromNow(-1),
      end_at: isoHoursFromNow(18),
      status: preSeed ? "active" : "sold_out",
    },
  ];

  let updated = 0;
  for (const update of rescueUpdates) {
    const result = await supabase.from("fresh_rescue_deals")
      .update(update)
      .eq("deal_id", update.deal_id)
      .select("deal_id");
    const rows = await assertOk(`${update.deal_id} rescue refresh`, result);
    updated += rows?.length ?? 0;
  }
  return updated;
}

const batchCount = await refreshBatches();
const inventoryCount = await refreshInventory();
const priceCount = await refreshPrices();
const rescueCount = await refreshRescueDeals();

await assertOk("sync_batch_statuses", await supabase.rpc("sync_batch_statuses"));
await assertOk("refresh_catalog_state", await supabase.rpc("refresh_catalog_state"));

console.log(JSON.stringify({
  refreshedAt: new Date().toISOString(),
  effectiveDate: dateWithOffset(0),
  mode: preSeed ? "pre-seed" : "final",
  batches: batchCount,
  inventory: inventoryCount,
  prices: priceCount,
  rescueDeals: rescueCount,
}, null, 2));
