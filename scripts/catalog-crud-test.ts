import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.107.0";

const baseUrl = Deno.args[0] ?? "http://127.0.0.1:55421";
const publishableKey = Deno.args[1];
const secretKey = Deno.args[2];
if (!publishableKey || !secretKey) {
  throw new Error("Usage: deno run --allow-net catalog-crud-test.ts <url> <publishable-key> <secret-key>");
}

const service = createClient(baseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = Date.now();
const createdAuthUsers: string[] = [];
const created = {
  suppliers: [] as string[],
  categories: [] as string[],
  products: [] as string[],
  batches: [] as string[],
  prices: [] as string[],
  deals: [] as string[],
};

type Role = "admin" | "manager";
type TestUser = { client: SupabaseClient; userId: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function isoDate(offsetDays: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function isoDateTime(offsetHours: number) {
  return new Date(Date.now() + offsetHours * 60 * 60 * 1000).toISOString();
}

async function createTestUser(role: Role): Promise<TestUser> {
  const email = `catalog-${role}-${suffix}@freshtrace.local`;
  const password = "FreshTrace!123";
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Catalog ${role} test` },
  });
  if (authError || !authData.user) throw authError ?? new Error("Could not create test user");
  createdAuthUsers.push(authData.user.id);

  const { data: roleRow, error: roleError } = await service.from("roles")
    .select("role_id").eq("role_name", role).single();
  if (roleError) throw roleError;
  const { data: profile, error: profileError } = await service.from("users")
    .update({ role_id: roleRow.role_id })
    .eq("auth_user_id", authData.user.id)
    .select("user_id").single();
  if (profileError) throw profileError;

  const client = createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, userId: profile.user_id };
}

async function expectFailure(label: string, operation: () => PromiseLike<{ error: unknown }>) {
  const result = await operation();
  if (!result.error) throw new Error(`Expected constraint failure: ${label}`);
  console.log(`PASS constraint: ${label}`);
}

async function expectDeleted(table: string, column: string, id: string, label: string) {
  const result = await service.from(table).select(column).eq(column, id).maybeSingle();
  if (result.error || result.data) {
    throw result.error ?? new Error(`${label} was not deleted`);
  }
  console.log(`PASS delete: ${label}`);
}

async function cleanup() {
  for (const dealId of created.deals) await service.from("fresh_rescue_deals").delete().eq("deal_id", dealId);
  for (const priceId of created.prices) await service.from("prices").delete().eq("price_id", priceId);
  for (const batchId of created.batches) {
    await service.from("inventory_transactions").delete().eq("batch_id", batchId);
    await service.from("batches").delete().eq("batch_id", batchId);
  }
  for (const productId of created.products) await service.from("products").delete().eq("product_id", productId);
  for (const categoryId of created.categories) await service.from("categories").delete().eq("category_id", categoryId);
  for (const supplierId of created.suppliers) {
    await service.from("supplier_approval_history").delete().eq("supplier_id", supplierId);
    await service.from("suppliers").delete().eq("supplier_id", supplierId);
  }
  for (const authUserId of createdAuthUsers) await service.auth.admin.deleteUser(authUserId);
}

try {
  const manager = await createTestUser("manager");
  const systemAdmin = await createTestUser("admin");

  const pendingSupplierResult = await manager.client.from("suppliers").insert({
    name: `Pending supplier ${suffix}`,
    certificate: "PENDING-CERT",
    description: "Catalog constraint test",
  }).select("supplier_id,status").single();
  if (pendingSupplierResult.error) throw pendingSupplierResult.error;
  const pendingSupplier = pendingSupplierResult.data;
  created.suppliers.push(pendingSupplier.supplier_id);
  await expectFailure("manager cannot self-approve supplier", () =>
    manager.client.from("suppliers").update({ status: "approved" })
      .eq("supplier_id", pendingSupplier.supplier_id));

  const approvedSupplierResult = await manager.client.from("suppliers").insert({
    name: `Approved supplier ${suffix}`,
    certificate: "APPROVED-CERT",
    description: "Catalog CRUD test",
  }).select("supplier_id").single();
  if (approvedSupplierResult.error) throw approvedSupplierResult.error;
  const approvedSupplier = approvedSupplierResult.data;
  created.suppliers.push(approvedSupplier.supplier_id);
  const approval = await systemAdmin.client.rpc("approve_supplier", {
    p_supplier_id: approvedSupplier.supplier_id,
    p_status: "approved",
    p_response: "Approved by catalog CRUD integration test",
  });
  if (approval.error) throw approval.error;

  const alternateSupplierResult = await manager.client.from("suppliers").insert({
    name: `Alternate supplier ${suffix}`,
    certificate: "ALTERNATE-CERT",
    description: "Used to verify supplier traceability constraints",
  }).select("supplier_id").single();
  if (alternateSupplierResult.error) throw alternateSupplierResult.error;
  const alternateSupplier = alternateSupplierResult.data;
  created.suppliers.push(alternateSupplier.supplier_id);
  const alternateApproval = await systemAdmin.client.rpc("approve_supplier", {
    p_supplier_id: alternateSupplier.supplier_id,
    p_status: "approved",
    p_response: "Approved for catalog relation tests",
  });
  if (alternateApproval.error) throw alternateApproval.error;

  const categoryResult = await manager.client.from("categories").insert({
    name: `Catalog test category ${suffix}`,
    description: "Initial category description",
  }).select("category_id").single();
  if (categoryResult.error) throw categoryResult.error;
  const categoryId = categoryResult.data.category_id;
  created.categories.push(categoryId);
  const categoryUpdate = await manager.client.from("categories")
    .update({ description: "Updated category description" })
    .eq("category_id", categoryId);
  if (categoryUpdate.error) throw categoryUpdate.error;
  const categoryDeactivate = await manager.client.from("categories")
    .update({ status: "inactive" }).eq("category_id", categoryId);
  if (categoryDeactivate.error) throw categoryDeactivate.error;
  const categoryReactivate = await manager.client.from("categories")
    .update({ status: "active" }).eq("category_id", categoryId);
  if (categoryReactivate.error) throw categoryReactivate.error;
  await expectFailure("category name must remain unique", () =>
    manager.client.from("categories").insert({
      name: `Catalog test category ${suffix}`,
      description: "Duplicate category constraint test",
    }));

  await expectFailure("product cannot use pending supplier", () =>
    manager.client.from("products").insert({
      category_id: categoryId,
      supplier_id: pendingSupplier.supplier_id,
      name: `Rejected product ${suffix}`,
      unit: "kg",
    }));

  const productResult = await manager.client.from("products").insert({
    category_id: categoryId,
    supplier_id: approvedSupplier.supplier_id,
    name: `Catalog product ${suffix}`,
    description: "Initial product description",
    unit: "kg",
  }).select("product_id").single();
  if (productResult.error) throw productResult.error;
  const productId = productResult.data.product_id;
  created.products.push(productId);
  const productUpdate = await manager.client.from("products")
    .update({ description: "Updated product description" })
    .eq("product_id", productId);
  if (productUpdate.error) throw productUpdate.error;
  const productDeactivate = await manager.client.from("products")
    .update({ status: "inactive" }).eq("product_id", productId);
  if (productDeactivate.error) throw productDeactivate.error;
  const productReactivate = await manager.client.from("products")
    .update({ status: "active" }).eq("product_id", productId);
  if (productReactivate.error) throw productReactivate.error;

  await expectFailure("batch expiry cannot precede harvest", () =>
    manager.client.from("batches").insert({
      product_id: productId,
      supplier_id: approvedSupplier.supplier_id,
      batch_code: `INVALID-${suffix}`,
      harvest_date: isoDate(2),
      expire_date: isoDate(1),
      quantity: 10,
    }));

  const batchResult = await manager.client.from("batches").insert({
    product_id: productId,
    supplier_id: approvedSupplier.supplier_id,
    batch_code: `CRUD-${suffix}`,
    harvest_date: isoDate(-1),
    expire_date: isoDate(2),
    quantity: 20,
    origin_location: "Integration test farm",
  }).select("batch_id").single();
  if (batchResult.error) throw batchResult.error;
  const batchId = batchResult.data.batch_id;
  created.batches.push(batchId);
  await expectFailure("batch code must remain unique", () =>
    manager.client.from("batches").insert({
      product_id: productId,
      supplier_id: approvedSupplier.supplier_id,
      batch_code: `CRUD-${suffix}`,
      harvest_date: isoDate(-1),
      expire_date: isoDate(2),
      quantity: 10,
    }));
  await expectFailure("product supplier cannot change after batches exist", () =>
    manager.client.from("products").update({
      supplier_id: alternateSupplier.supplier_id,
    }).eq("product_id", productId));

  const initialInventory = await manager.client.from("inventory")
    .select("quantity_available,quantity_reserved").eq("batch_id", batchId).single();
  if (initialInventory.error || initialInventory.data.quantity_available !== 20) {
    throw initialInventory.error ?? new Error("Batch creation did not create matching inventory");
  }

  const batchUpdate = await manager.client.rpc("update_batch_and_inventory", {
    p_batch_id: batchId,
    p_product_id: productId,
    p_supplier_id: approvedSupplier.supplier_id,
    p_batch_code: `CRUD-${suffix}`,
    p_harvest_date: isoDate(-1),
    p_expire_date: isoDate(2),
    p_quantity: 25,
    p_origin_location: "Updated integration test farm",
    p_status: "near_expiry",
  });
  if (batchUpdate.error) throw batchUpdate.error;

  const updatedInventory = await manager.client.from("inventory")
    .select("quantity_available,quantity_reserved").eq("batch_id", batchId).single();
  if (updatedInventory.error || updatedInventory.data.quantity_available !== 25) {
    throw updatedInventory.error ?? new Error("Atomic batch edit did not synchronize inventory");
  }
  const inventoryAudit = await manager.client.from("inventory_transactions")
    .select("transaction_id").eq("batch_id", batchId).eq("type", "adjust");
  if (inventoryAudit.error || !inventoryAudit.data.length) {
    throw inventoryAudit.error ?? new Error("Atomic batch edit did not create an audit transaction");
  }

  const rollbackBatchResult = await manager.client.from("batches").insert({
    product_id: productId,
    supplier_id: approvedSupplier.supplier_id,
    batch_code: `ROLLBACK-${suffix}`,
    harvest_date: isoDate(-1),
    expire_date: isoDate(2),
    quantity: 10,
  }).select("batch_id").single();
  if (rollbackBatchResult.error) throw rollbackBatchResult.error;
  created.batches.push(rollbackBatchResult.data.batch_id);
  const auditCountBeforeRollback = await manager.client.from("inventory_transactions")
    .select("transaction_id", { count: "exact", head: true }).eq("batch_id", batchId);
  if (auditCountBeforeRollback.error) throw auditCountBeforeRollback.error;
  await expectFailure("failed atomic batch edit rolls back batch and inventory", () =>
    manager.client.rpc("update_batch_and_inventory", {
      p_batch_id: batchId,
      p_product_id: productId,
      p_supplier_id: approvedSupplier.supplier_id,
      p_batch_code: `ROLLBACK-${suffix}`,
      p_harvest_date: isoDate(-1),
      p_expire_date: isoDate(2),
      p_quantity: 30,
      p_origin_location: "This update must roll back",
      p_status: "available",
    }));
  const rollbackState = await manager.client.from("batches")
    .select("batch_code,quantity,origin_location,inventory(quantity_available)")
    .eq("batch_id", batchId).single();
  const auditCountAfterRollback = await manager.client.from("inventory_transactions")
    .select("transaction_id", { count: "exact", head: true }).eq("batch_id", batchId);
  if (rollbackState.error
    || auditCountAfterRollback.error
    || rollbackState.data.batch_code !== `CRUD-${suffix}`
    || rollbackState.data.quantity !== 25
    || rollbackState.data.origin_location !== "Updated integration test farm"
    || one(rollbackState.data.inventory)?.quantity_available !== 25
    || auditCountAfterRollback.count !== auditCountBeforeRollback.count) {
    throw rollbackState.error ?? auditCountAfterRollback.error
      ?? new Error("Failed atomic batch edit changed catalog or inventory state");
  }

  await expectFailure("direct batch quantity edit is blocked", () =>
    manager.client.from("batches").update({ quantity: 30 }).eq("batch_id", batchId));
  const productInactive = await manager.client.from("products")
    .update({ status: "inactive" }).eq("product_id", productId);
  if (productInactive.error) throw productInactive.error;
  await expectFailure("new batch cannot use an inactive product", () =>
    manager.client.from("batches").insert({
      product_id: productId,
      supplier_id: approvedSupplier.supplier_id,
      batch_code: `INACTIVE-${suffix}`,
      harvest_date: isoDate(-1),
      expire_date: isoDate(2),
      quantity: 10,
    }));
  const batchLock = await manager.client.from("batches")
    .update({ status: "locked" }).eq("batch_id", batchId);
  if (batchLock.error) throw batchLock.error;
  const productActive = await manager.client.from("products")
    .update({ status: "active" }).eq("product_id", productId);
  if (productActive.error) throw productActive.error;
  const batchUnlock = await manager.client.from("batches")
    .update({ status: "near_expiry" }).eq("batch_id", batchId);
  if (batchUnlock.error) throw batchUnlock.error;

  const reserveInventory = await service.from("inventory")
    .update({ quantity_reserved: 5 }).eq("batch_id", batchId);
  if (reserveInventory.error) throw reserveInventory.error;
  await expectFailure("inventory cannot be adjusted below reserved stock", () =>
    manager.client.rpc("adjust_inventory", {
      p_batch_id: batchId,
      p_new_quantity: 4,
      p_note: "Reserved stock constraint test",
    }));
  const releaseInventory = await service.from("inventory")
    .update({ quantity_reserved: 0 }).eq("batch_id", batchId);
  if (releaseInventory.error) throw releaseInventory.error;
  await expectFailure("inventory cannot be negative", () =>
    manager.client.rpc("adjust_inventory", {
      p_batch_id: batchId,
      p_new_quantity: -1,
      p_note: "Negative inventory constraint test",
    }));

  const priceResult = await manager.client.from("prices").insert({
    product_id: productId,
    batch_id: batchId,
    price: 120000,
    price_type: "normal",
    start_date: isoDate(0),
  }).select("price_id").single();
  if (priceResult.error) throw priceResult.error;
  const priceId = priceResult.data.price_id;
  created.prices.push(priceId);
  const priceUpdate = await manager.client.from("prices")
    .update({ price: 115000 }).eq("price_id", priceId);
  if (priceUpdate.error) throw priceUpdate.error;
  await expectFailure("price batch must belong to its product", () =>
    manager.client.from("prices").insert({
      product_id: productId,
      batch_id: "40000000-0000-0000-0000-000000000001",
      price: 99000,
      price_type: "normal",
      start_date: isoDate(0),
    }));
  await expectFailure("price period cannot end before it starts", () =>
    manager.client.from("prices").insert({
      product_id: productId,
      batch_id: batchId,
      price: 99000,
      price_type: "promotion",
      start_date: isoDate(2),
      end_date: isoDate(1),
    }));

  await expectFailure("rescue price must be lower than original price", () =>
    manager.client.from("fresh_rescue_deals").insert({
      batch_id: batchId,
      title: `Invalid rescue ${suffix}`,
      original_price: 100000,
      rescue_price: 120000,
      start_at: isoDateTime(-1),
      end_at: isoDateTime(12),
      status: "active",
      created_by: manager.userId,
    }));

  const rescueResult = await manager.client.from("fresh_rescue_deals").insert({
    batch_id: batchId,
    title: `Catalog rescue ${suffix}`,
    description: "Fresh Rescue CRUD integration test",
    original_price: 115000,
    rescue_price: 80000,
    start_at: isoDateTime(-1),
    end_at: isoDateTime(12),
    status: "active",
    created_by: manager.userId,
  }).select("deal_id").single();
  if (rescueResult.error) throw rescueResult.error;
  const dealId = rescueResult.data.deal_id;
  created.deals.push(dealId);

  const rescueUpdate = await manager.client.from("fresh_rescue_deals")
    .update({ rescue_price: 75000 }).eq("deal_id", dealId);
  if (rescueUpdate.error) throw rescueUpdate.error;
  const rescueDeactivate = await manager.client.from("fresh_rescue_deals")
    .update({ status: "inactive" }).eq("deal_id", dealId);
  if (rescueDeactivate.error) throw rescueDeactivate.error;
  const rescueReactivate = await manager.client.from("fresh_rescue_deals")
    .update({ status: "active" }).eq("deal_id", dealId);
  if (rescueReactivate.error) throw rescueReactivate.error;
  await expectFailure("batch cannot have two active rescue deals", () =>
    manager.client.from("fresh_rescue_deals").insert({
      batch_id: batchId,
      title: `Duplicate rescue ${suffix}`,
      original_price: 115000,
      rescue_price: 70000,
      start_at: isoDateTime(-1),
      end_at: isoDateTime(10),
      status: "active",
      created_by: manager.userId,
    }));
  await expectFailure("rescue deal cannot use a far-expiry batch", () =>
    manager.client.from("fresh_rescue_deals").insert({
      batch_id: "40000000-0000-0000-0000-000000000015",
      title: `Far expiry rescue ${suffix}`,
      original_price: 72000,
      rescue_price: 60000,
      start_at: isoDateTime(-1),
      end_at: isoDateTime(10),
      status: "active",
      created_by: manager.userId,
    }));

  const reserveAllSellableStock = await service.from("inventory")
    .update({ quantity_reserved: 25 }).eq("batch_id", batchId);
  if (reserveAllSellableStock.error) throw reserveAllSellableStock.error;
  const soldOutState = await manager.client.from("batches")
    .select("status,fresh_rescue_deals(status)").eq("batch_id", batchId).single();
  if (soldOutState.error
    || soldOutState.data.status !== "sold_out"
    || !soldOutState.data.fresh_rescue_deals?.some((deal: { status: string }) => deal.status === "sold_out")) {
    throw soldOutState.error ?? new Error("Reserved stock did not synchronize sold-out catalog state");
  }
  const releaseSellableStock = await service.from("inventory")
    .update({ quantity_reserved: 0 }).eq("batch_id", batchId);
  if (releaseSellableStock.error) throw releaseSellableStock.error;
  const restoredState = await manager.client.from("batches")
    .select("status,fresh_rescue_deals(status)").eq("batch_id", batchId).single();
  if (restoredState.error
    || restoredState.data.status !== "near_expiry"
    || !restoredState.data.fresh_rescue_deals?.some((deal: { status: string }) => deal.status === "active")) {
    throw restoredState.error ?? new Error("Released stock did not restore sellable catalog state");
  }
  const farExpiryBatch = await manager.client.rpc("update_batch_and_inventory", {
    p_batch_id: batchId,
    p_product_id: productId,
    p_supplier_id: approvedSupplier.supplier_id,
    p_batch_code: `CRUD-${suffix}`,
    p_harvest_date: isoDate(-1),
    p_expire_date: isoDate(10),
    p_quantity: 25,
    p_origin_location: "Far-expiry rescue eligibility check",
    p_status: "available",
  });
  if (farExpiryBatch.error) throw farExpiryBatch.error;
  const rescueAfterFarExpiry = await manager.client.from("fresh_rescue_deals")
    .select("status")
    .eq("deal_id", dealId)
    .single();
  if (rescueAfterFarExpiry.error || rescueAfterFarExpiry.data.status !== "inactive") {
    throw rescueAfterFarExpiry.error ?? new Error("Fresh Rescue stayed active after the batch left the near-expiry window");
  }
  await expectFailure("inactive Fresh Rescue cannot be reactivated for a far-expiry batch", () =>
    manager.client.from("fresh_rescue_deals")
      .update({ status: "active" })
      .eq("deal_id", dealId));
  const nearExpiryBatch = await manager.client.rpc("update_batch_and_inventory", {
    p_batch_id: batchId,
    p_product_id: productId,
    p_supplier_id: approvedSupplier.supplier_id,
    p_batch_code: `CRUD-${suffix}`,
    p_harvest_date: isoDate(-1),
    p_expire_date: isoDate(2),
    p_quantity: 25,
    p_origin_location: "Near-expiry rescue eligibility restored",
    p_status: "near_expiry",
  });
  if (nearExpiryBatch.error) throw nearExpiryBatch.error;
  const rescueReactivated = await manager.client.from("fresh_rescue_deals")
    .update({ status: "active" })
    .eq("deal_id", dealId)
    .select("status")
    .single();
  if (rescueReactivated.error || rescueReactivated.data.status !== "active") {
    throw rescueReactivated.error ?? new Error("Fresh Rescue could not be reactivated after eligibility was restored");
  }

  const joinedProduct = await manager.client.from("products")
    .select("description,categories(description),suppliers(status),batches(quantity,inventory(quantity_available)),prices(price)")
    .eq("product_id", productId).single();
  if (joinedProduct.error
    || joinedProduct.data.description !== "Updated product description"
    || !joinedProduct.data.batches?.some((batch: { quantity: number; inventory: unknown }) => batch.quantity === 25)
    || !joinedProduct.data.prices?.some((price: { price: number }) => Number(price.price) === 115000)) {
    throw joinedProduct.error ?? new Error("Related catalog data did not reflect CRUD updates");
  }

  const supplierResubmission = await manager.client.from("suppliers")
    .update({
      description: "Updated supplier details require Admin re-approval",
      status: "pending",
      approved_by: null,
      approved_at: null,
    })
    .eq("supplier_id", approvedSupplier.supplier_id)
    .select("status,description").single();
  if (supplierResubmission.error
    || supplierResubmission.data.status !== "pending"
    || supplierResubmission.data.description !== "Updated supplier details require Admin re-approval") {
    throw supplierResubmission.error ?? new Error("Approved supplier could not be edited and resubmitted");
  }
  const linkedProductEdit = await manager.client.from("products")
    .update({
      supplier_id: approvedSupplier.supplier_id,
      description: "Product metadata remains editable during supplier review",
    })
    .eq("product_id", productId)
    .select("description,supplier_id").single();
  if (linkedProductEdit.error
    || linkedProductEdit.data.supplier_id !== approvedSupplier.supplier_id
    || linkedProductEdit.data.description !== "Product metadata remains editable during supplier review") {
    throw linkedProductEdit.error ?? new Error("Linked product could not be edited during supplier review");
  }
  const linkedBatchEdit = await manager.client.rpc("update_batch_and_inventory", {
    p_batch_id: batchId,
    p_product_id: productId,
    p_supplier_id: approvedSupplier.supplier_id,
    p_batch_code: `CRUD-${suffix}`,
    p_harvest_date: isoDate(-1),
    p_expire_date: isoDate(2),
    p_quantity: 25,
    p_origin_location: "Batch metadata remains editable during supplier review",
    p_status: "near_expiry",
  });
  if (linkedBatchEdit.error) throw linkedBatchEdit.error;
  await expectFailure("new batch cannot use supplier pending review", () =>
    manager.client.from("batches").insert({
      product_id: productId,
      supplier_id: approvedSupplier.supplier_id,
      batch_code: `PENDING-${suffix}`,
      harvest_date: isoDate(-1),
      expire_date: isoDate(2),
      quantity: 10,
    }));

  await expectFailure("category with products cannot be hard-deleted", () =>
    manager.client.from("categories").delete().eq("category_id", categoryId));
  await expectFailure("product with batches cannot be hard-deleted", () =>
    manager.client.from("products").delete().eq("product_id", productId));
  await expectFailure("batch with prices/rescue cannot be hard-deleted", () =>
    manager.client.from("batches").delete().eq("batch_id", batchId));
  await expectFailure("approved supplier with linked products cannot be hard-deleted", () =>
    systemAdmin.client.from("suppliers").delete().eq("supplier_id", approvedSupplier.supplier_id));
  await expectFailure("catalog delete workflow reports referenced category", () =>
    manager.client.rpc("delete_catalog_record", { p_entity: "category", p_id: categoryId }));
  await expectFailure("catalog delete workflow reports referenced supplier", () =>
    manager.client.rpc("delete_catalog_record", { p_entity: "supplier", p_id: approvedSupplier.supplier_id }));
  await expectFailure("catalog delete workflow reports referenced product", () =>
    manager.client.rpc("delete_catalog_record", { p_entity: "product", p_id: productId }));
  await expectFailure("catalog delete workflow reports referenced batch", () =>
    manager.client.rpc("delete_catalog_record", { p_entity: "batch", p_id: batchId }));

  const disposableCategory = await manager.client.from("categories").insert({
    name: `Disposable category ${suffix}`,
    description: "Deleted by catalog workflow verification",
  }).select("category_id").single();
  if (disposableCategory.error) throw disposableCategory.error;
  const workflowDelete = await manager.client.rpc("delete_catalog_record", {
    p_entity: "category",
    p_id: disposableCategory.data.category_id,
  });
  if (workflowDelete.error) throw workflowDelete.error;
  const deletedCategory = await service.from("categories").select("category_id")
    .eq("category_id", disposableCategory.data.category_id).maybeSingle();
  if (deletedCategory.error || deletedCategory.data) {
    throw deletedCategory.error ?? new Error("Catalog delete workflow did not delete an unreferenced category");
  }

  const disposableSupplier = await manager.client.from("suppliers").insert({
    name: `Disposable supplier ${suffix}`,
    description: "Deleted by catalog workflow verification",
  }).select("supplier_id").single();
  if (disposableSupplier.error) throw disposableSupplier.error;
  const deleteSupplier = await manager.client.rpc("delete_catalog_record", {
    p_entity: "supplier",
    p_id: disposableSupplier.data.supplier_id,
  });
  if (deleteSupplier.error) throw deleteSupplier.error;
  await expectDeleted("suppliers", "supplier_id", disposableSupplier.data.supplier_id, "unreferenced supplier");

  const disposableProduct = await manager.client.from("products").insert({
    category_id: categoryId,
    supplier_id: null,
    name: `Disposable product ${suffix}`,
    unit: "item",
  }).select("product_id").single();
  if (disposableProduct.error) throw disposableProduct.error;
  const disposablePrice = await manager.client.from("prices").insert({
    product_id: disposableProduct.data.product_id,
    batch_id: null,
    price: 10000,
    price_type: "normal",
    start_date: isoDate(0),
  }).select("price_id").single();
  if (disposablePrice.error) throw disposablePrice.error;
  const deletePrice = await manager.client.rpc("delete_catalog_record", {
    p_entity: "price",
    p_id: disposablePrice.data.price_id,
  });
  if (deletePrice.error) throw deletePrice.error;
  await expectDeleted("prices", "price_id", disposablePrice.data.price_id, "unreferenced price");
  const deleteProduct = await manager.client.rpc("delete_catalog_record", {
    p_entity: "product",
    p_id: disposableProduct.data.product_id,
  });
  if (deleteProduct.error) throw deleteProduct.error;
  await expectDeleted("products", "product_id", disposableProduct.data.product_id, "unreferenced product");

  const deleteRescue = await manager.client.rpc("delete_catalog_record", {
    p_entity: "rescue",
    p_id: dealId,
  });
  if (deleteRescue.error) throw deleteRescue.error;
  await expectDeleted("fresh_rescue_deals", "deal_id", dealId, "unreferenced Fresh Rescue deal");
  created.deals.splice(created.deals.indexOf(dealId), 1);

  const sync = await manager.client.rpc("refresh_catalog_state");
  if (sync.error) throw sync.error;

  console.log("PASS CRUD: supplier approval/resubmission, category, product, batch, inventory, price and rescue");
  console.log("PASS status: category/product activation, inactive-product batch maintenance, sellable stock, batch lock and Fresh Rescue activation");
  console.log("PASS propagation: related joins, inventory synchronization and audit history");
  console.log("PASS deletion policy: referenced catalog history is protected by foreign keys");
  console.log("PASS delete workflow: unreferenced records delete and referenced records report a violation");
} finally {
  await cleanup();
}
