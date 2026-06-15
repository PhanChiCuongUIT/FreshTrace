# Catalog CRUD and data integrity

## Immediate update behavior

- Supplier edits are submitted as `pending`. Linked products and batches remain stored, but public catalog queries only expose approved suppliers.
- Existing product and batch metadata can still be corrected while their linked supplier is pending re-approval. New products and batches still require an approved supplier.
- Category and product edits are visible after the Manager Catalog query cache is invalidated. Inactive records are hidden from customer catalog and checkout queries.
- A product supplier becomes immutable after the product has a batch. This preserves the supplier recorded by batch traceability, inventory, QR and order history.
- Batch creation automatically creates inventory and an initial inventory transaction.
- Batch quantity edits use `update_batch_and_inventory`. Batch, inventory, and inventory audit history are updated in one database transaction.
- Existing batches can be locked or corrected after their product is inactive, but new batches can only be created for active products.
- Automatic `sold_out` state uses sellable quantity (`quantity_available - quantity_reserved`), so fully reserved stock is not exposed as available.
- Price edits affect current and future catalog price selection. Existing order items retain their captured purchase price.
- The Prices editor creates `normal` and `promotion` prices. The Rescue editor
  lets the Manager enter only the discounted rescue price; `original_price` is
  read-only in the UI and is stored from the current active `prices` row.
- Fresh Rescue edits refresh customer rescue listings. Deal and batch statuses are recalculated after batch, inventory, or rescue changes.
- Product image changes are staged as local previews. The image is uploaded to
  Cloudinary only after the Manager confirms Save, so cancelling an edit does not
  leave an unused product image URL in the catalog.
- The fixed demo batch UUIDs are refreshed with relative dates by migration `202606120005_refresh_demo_catalog_dates.sql`. User-created catalog data is never modified by that migration.

## Constraint handling

| Operation | Database rule | Application handling |
| --- | --- | --- |
| Approve supplier | Managers cannot self-approve | Admin uses `approve_supplier`; Manager receives the database error |
| Product supplier | Supplier must be approved | Save fails with a clear constraint message |
| Product supplier change | Supplier cannot change after batches exist | Manager must create a separate product for a different supplier |
| Batch product | Product must be active and cannot change after creation | Edit keeps the original product; create validates the selected product |
| Existing inactive product | Existing batch metadata/status may still be maintained | Product remains fixed; creating another batch is blocked |
| Batch dates | Expiry cannot precede harvest | Save fails before partial data is committed |
| Batch quantity | Cannot be negative or lower than reserved stock | Atomic RPC rejects the edit and preserves old batch/inventory values |
| Sellable stock | Fully reserved stock is sold out | Batch and active Rescue status synchronize from available minus reserved |
| Direct batch quantity update | Direct table update is blocked | Manager Catalog uses the atomic RPC |
| Price batch | Batch must belong to the selected product | Trigger rejects mismatched data |
| Rescue deal | Active batch must expire within 3 days, have stock, have an active normal/promotion price, and use a lower rescue price | Trigger rejects invalid or duplicate active deals and overwrites `original_price` from the active catalog price |
| Hard delete | Referenced suppliers, categories, products, and batches are protected by foreign keys | UI uses status changes instead of hard delete; historical orders and audit data remain intact |

All Manager Catalog mutations show a confirmation dialog. Edit dialogs include linked-record counts or the expected downstream effect, and database errors are shown through the application feedback component. Inserts and updates request the saved primary key, preventing a stale or row-level-security-filtered operation from being reported as successful.

## Verification

Run:

```powershell
npm run test:catalog-crud
```

The test creates temporary records, verifies valid CRUD propagation, duplicate handling, atomic rollback, supplier/category/product/batch relationship rules, sellable-stock status synchronization, safe deletes, and expected constraint failures, then removes all temporary records.

## Inventory state and CRUD model

Inventory is intentionally handled as audited stock control instead of ordinary
hard-delete CRUD. A batch creates its inventory row automatically. Managers can
correct stock through the Inventory drawer, and every correction writes an
`inventory_transactions` row.

Adjustment types:

| Type | Meaning | Typical use |
| --- | --- | --- |
| `stock_count` | Set the counted physical available quantity | End-of-day or warehouse recount correction |
| `import` | Increase available quantity | Supplier delivers more accepted stock for the batch |
| `export` | Decrease available quantity | Waste, loss, manual outbound correction, or non-order stock removal |
| `reserve` | Increase reserved quantity | Manual reservation correction when an order reservation must be repaired |
| `release` | Release reserved quantity back to available stock | Cancelled order or reservation mismatch correction |

This model is more appropriate than editing/deleting inventory rows directly
because product traceability, order history, delivery verification, and finance
reports all depend on the stock trail remaining auditable.

## Coupon lifecycle

- Signup creates two free-shipping coupons and one 10% welcome coupon.
- Only completed orders with a delivered delivery count toward reward progress.
- Every 500,000 VND of delivered-order spending creates one free-shipping coupon.
- Every 1,000,000 VND of delivered-order spending creates one 10% coupon.
- Every 2,000,000 VND of delivered-order spending creates one 20% coupon.
- Every 5 delivered orders creates one free-shipping coupon.
- Every 10 delivered orders creates one 10% coupon.
- Every approved report creates one 10,000 VND fixed coupon.
- A delivered order worth at least 1,000,000 VND may create one random fixed coupon from 5,000 to 20,000 VND.
- Checkout deducts the applied discount and marks the coupon `used` immediately so it cannot be reused by another pending order.
- Cancelling an eligible pending order restores the applied coupon value, unless the coupon has already expired.
- Cancelling a paid pending order creates a full-value replacement coupon.
- After the order is completed successfully, its used coupon is removed instead of being kept in customer coupon history.

## Demo data baseline

Running `npm run backend:reset` followed by `npm run seed:demo` removes accumulated integration-test data and recreates:

- 7 role-based accounts: 1 Admin, 2 Managers, 2 Employees, and 2 Customers.
- 16 products, 16 batches, 16 inventory rows, 16 prices, and 5 suppliers,
  including the traceable Meat/Grass-fed Beef sample.
- 5 Fresh Rescue deals covering active, inactive, expired, and sold-out states.
- Orders and deliveries covering pending, assigned, picked-up, delivering, and delivered workflows.
- At least 5 reviews, reports, chat messages, assistant logs, coupons, inventory transactions, and notifications.

The four rows in `roles` are a fixed lookup set and are intentionally not expanded to five artificial roles.
