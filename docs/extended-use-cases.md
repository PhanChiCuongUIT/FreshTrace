# FreshTrace Extended Use Cases

This document separates the 34 report-defined MVP use cases from capabilities added
to complete the screen-navigation diagrams and improve operational usability.

## Existing Use Cases Strengthened

### UC18 - Customer and Manager Chat

- General support conversations no longer require an order or product.
- Order-specific and product-specific conversations still validate ownership and
  active product state.
- Realtime subscriptions update messages without manual refresh.

### UC19 - Manager and Shipper Chat

- The Manager and Shipper must be linked through an assigned order.
- Attachments and reactions use the same room-membership authorization.

### UC21 - Realtime Notifications

- The desktop sidebar and mobile menu show unread counts.
- Deep links resolve to valid Customer, Manager, Shipper, and Admin routes.

### UC27 - Batch Traceability

- Desktop web intentionally uses batch-code input.
- Mobile web exposes camera scanning.
- This avoids presenting a camera control in desktop environments where it is
  commonly unavailable or blocked.

### UC34 - Fresh Assistant

The Assistant now recognizes:

- Cheapest or lowest-price products.
- Products expiring soon or with the nearest expiry date.
- Products with a long remaining shelf life.
- Fresh Rescue savings.
- Certified or organic products.
- Rice, meat, fish, vegetable, fruit, mushroom, herb, and spice requests.

Each result provides an image, product detail navigation, current batch price,
expiry date, certificate, and an Add to cart action.

## Added Use Cases

### UC35 - Send a Chat Attachment

**Actors:** Customer, Manager, Employee, Admin  
**Preconditions:** The actor is an active member of the chat room.  
**Main flow:**

1. The actor selects a file up to 10 MB.
2. FreshTrace requests a role-authorized Cloudinary signature.
3. The browser uploads the file directly to Cloudinary.
4. FreshTrace stores the file URL, name, MIME type, and size with the message.
5. Room members receive the new message through Realtime.

**Alternative flows:**

- Oversized files are rejected before upload.
- Upload or database errors leave the composer content intact for retry.
- Non-members cannot read the message or attachment metadata.

### UC36 - React to a Chat Message

**Actors:** Any chat-room member  
**Main flow:**

1. The actor selects Like, Love, Laugh, Wow, or Sad.
2. FreshTrace stores at most one reaction for that user and message.
3. Selecting another reaction replaces it; selecting the same reaction removes it.
4. Room members receive reaction changes through Realtime.

**Security:** Reaction read/write policies verify room membership. Only the reaction
owner can remove it.

### UC37 - Customer Analytics Removed

This page is no longer part of the active FreshTrace scope. The route, sidebar item,
and frontend page were removed. Admin financial reporting remains in UC38 and UC42.

### UC38 - Review Financial Reports

**Actor:** Admin  
**Main flow:**

1. Admin opens Financial Reports.
2. Admin selects a specific week, month, or year.
3. FreshTrace summarizes recognized paid revenue, pending value, failures, payment
   methods, and top completed products for the selected period.
4. Admin reviews the matching transaction records.

**Accounting rule:** Revenue is recognized only from `payments.status = 'paid'`.

### UC39 - Pack a Multi-Supplier Order

**Actor:** Manager  
**Preconditions:** A Customer order may contain batches from multiple approved
suppliers.  
**Main flow:**

1. Manager opens Order Operations.
2. FreshTrace groups order items by supplier for packing and traceability.
3. The fulfillment center consolidates the groups into one Customer order.
4. Manager assigns one Shipper to the consolidated delivery.

## Multi-Supplier Decision

FreshTrace currently models Managers as centralized marketplace operations staff,
not as independent sellers or store owners. Products belong to Suppliers, while
Managers can operate the complete approved catalog. Therefore:

- The cart can contain products from multiple Suppliers.
- Checkout creates one atomic order and one payment.
- Inventory is reserved per batch in the same transaction.
- Packing is grouped by Supplier for operational clarity.
- One Shipper delivers the consolidated order.

This is consistent with the report's order, assignment, and delivery use cases. A
seller-managed marketplace would require a different domain model: stores,
manager-to-store ownership, parent orders, supplier sub-orders, split payments,
multiple deliveries, and partial cancellation/refund rules. Those concepts are not
part of the current 34-use-case contract and are intentionally not implied.

### UC40 - Settle COD at the Doorstep with payOS

**Actors:** Customer, Employee/Shipper  
**Preconditions:** The assigned delivery is in `delivering` and the order uses COD.  
**Main flow:**

1. The Shipper opens the assigned delivery.
2. For cash, the Shipper confirms receipt and FreshTrace creates a remittance
   obligation.
3. The Shipper scans/opens the remittance payOS QR and completes the transfer.
4. For direct transfer, the Shipper instead displays the Customer payOS QR.
5. The Customer scans that QR and pays directly.
6. The signed webhook records only the matching collection/remittance purpose.
7. FreshTrace permits delivery completion only after the required settlement.

### UC41 - Cancel a Paid Pending Order with a Coupon

**Actor:** Customer  
**Preconditions:** The order is still `pending`.  
**Main flow:**

1. The Customer requests cancellation and confirms the warning.
2. FreshTrace releases reserved inventory and cancels the order.
3. If payment is `paid`, FreshTrace creates one active coupon for the full paid
   amount and notifies the Customer.
4. Orders in every other status reject cancellation.

### UC42 - Export a Financial Report

**Actor:** Admin  
**Main flow:**

1. Admin opens Financial Reports.
2. Admin reviews recognized revenue and transaction statistics.
3. Admin exports the selected period as a UTF-8 CSV file for spreadsheet analysis.

### UC43-UC46 - Sharing, Promotions, Recovery, and Operational Filters

The implementation also adds structured Product/Order sharing, welcome and loyalty
coupons, email-based password recovery, role-authorized batch QR rendering, and
consistent search/filter controls across Admin and Manager operational pages. The
complete Actor-to-Database flow is recorded in [FreshTrace End-to-End Use Case
Coverage](use-case-coverage.md).
