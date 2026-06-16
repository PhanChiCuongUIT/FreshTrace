# FreshTrace Report-to-Implementation Use Case Differences

Baseline: `DA1_23520207_PhanChiCuong_SE121.Q21.docx`, reviewed on June 13, 2026.
The report contains 45 active use cases: UC01-UC36 and UC38-UC46. UC37 is skipped
because Customer Analytics was removed from scope.

## Classification

- **Aligned:** implementation follows the report without a material scope change.
- **Strengthened:** the same user goal remains, but validation, security, feedback,
  automation, or supported alternatives were added.
- **Expanded:** the actor, result, or business flow is broader than the report text.
- **New:** implementation contains a distinct user goal that is not separately
  specified by the report.

## Detailed Comparison

| UC | Report scope | Current implementation difference | Class |
|---|---|---|---|
| UC01 Login | Email/password login and role routing | Also blocks inactive/banned profiles and preserves role-specific desktop/mobile routing | Strengthened |
| UC02 User management | Admin searches, filters and changes role/status | Adds account creation, protected last/self Admin rules, mandatory reason and email for inactive/ban, permanent ban, and deletion of eligible banned users | Expanded |
| UC03 Supplier approval | Manager submits; Admin approves/rejects | Editing an approved Supplier clears approval and resubmits it as pending; approval history is retained; linked public catalog data stays hidden until reapproval | Expanded |
| UC04 Category management | Create, edit, search, filter, activate/deactivate | Adds confirmed hard-delete for unreferenced Categories and a clear foreign-key warning/deactivate alternative for referenced Categories | Strengthened |
| UC05 Product management | Dedicated create/edit and validation | Adds Cloudinary file upload, consistent image resolution, activate/deactivate, guarded hard-delete, and downstream impact warning | Expanded |
| UC06 Batch management | Dedicated create/edit; initialize Inventory | Product becomes immutable after creation; quantity edit is atomic with Inventory and audit history; guarded delete explains traceability/price/order dependencies | Expanded |
| UC07 Batch QR generation | Generate/display signed trace QR | Aligned; the generated QR is reused from Product, Order and Shipper screens | Aligned |
| UC08 Inventory management | Search batches and adjust stock | Adds adjustment reasons, audit-history search/filter, reserved-stock protection, nonnegative checks and automatic Batch status synchronization | Expanded |
| UC09 Price management | Create/edit normal, promotion and rescue prices | Adds guarded delete, batch/product ownership validation, date validation, and preservation of historical Order Item prices | Strengthened |
| UC10 Fresh Rescue management | Create/edit/deactivate eligible deals | Adds guarded delete, duplicate-active-deal prevention, automatic expired/sold-out synchronization, and immediate customer cache refresh | Strengthened |
| UC11 Browse/buy Fresh Rescue | Responsive Rescue listing, detail and cart | Aligned; image fallback and current-stock/current-price checks were hardened | Strengthened |
| UC12 Manager order operations | Search/filter, confirm and prepare orders | Adds unified workflow/tracking status presentation, Supplier packing groups, confirmations and Order timeline | Strengthened |
| UC13 Assign delivery | Filter Shippers and confirm assignment | Adds active-assignment validation and notification/chat creation | Strengthened |
| UC14 Shipper assigned deliveries | Mobile cards for assigned jobs | Adds tabs for assigned, picked-up, delivering and delivered, plus Order search and per-delivery tracking | Expanded |
| UC15 Shipper batch verification | Camera/image/order QR verification | Aligned; each required Batch is marked immediately and pickup is blocked until all checks pass | Strengthened |
| UC16 Delivery status | Picked-up, delivering, delivered or failed | Adds payment/remittance completion gates and directs a Customer who did not receive a delivered Order into the report workflow | Expanded |
| UC17 Customer-Shipper chat | Order-linked realtime chat | Automatic room creation, grouped avatars, attachment, reaction and share flows are integrated | Strengthened |
| UC18 Customer-Manager chat | General/product/owned-order chat | Customer-Manager chat now reuses one room per customer/manager pair; product/order cards are shared inside that room after relationship validation | Strengthened |
| UC19 Manager-Shipper chat | Operational chat for assigned Orders | Assignment authorization and automatic room membership were hardened | Strengthened |
| UC20 Manager-Admin chat | Governance/operations chat | Role-pair authorization and profile preview were added | Strengthened |
| UC21 Realtime notifications | Unread list, realtime updates and deep links | Adds Mark all as read, unread badges, normalized role-specific links, and report/coupon/governance notifications | Expanded |
| UC22 Reports/complaints | Customer complaint; Admin resolve/reject | Adds related-user reports, delivery-not-received reports, 10K approved-report reward, and notifications to reporter, reported user and assigned Manager | Expanded |
| UC23 Registration | Customer registration and email confirmation | Adds real SMTP/Gmail delivery, branded email, mobile-safe redirect and three welcome coupons | Expanded |
| UC24 Account management | Profile/avatar and emailed password recovery | Avatar is uploaded to Cloudinary but applied only after Save; Customer Profile adds Coupon, Transaction and Policy/Guide tabs | Expanded |
| UC25 Browse products | Responsive catalog and detail | Uses one Cloudinary image resolver across Product, Home, Assistant and Chat; Product details expose Batch QR/trace actions | Strengthened |
| UC26 Product search/filter | Keyword, Category, certificate, price and Rescue | Server-side filtering remains aligned; food-type matching and result consistency were improved | Strengthened |
| UC27 Traceability QR | Camera/image/Product/Order/manual trace | Aligned; supports live camera capture, local QR image upload and signed direct trace URL | Aligned |
| UC28 Cart management | Add/update/note/remove with confirmation | Adds immediate query-cache synchronization, stock/batch invariants and confirmation feedback | Strengthened |
| UC29 Shopping notes | Item and Order notes | Aligned; checkout stores immutable note snapshots | Aligned |
| UC30 Checkout | Address, payment, coupon and total | Coupon application is single-use and atomic with stock reservation, Order Items and Payment creation | Strengthened |
| UC31 Payment | payOS prepay and COD at delivery | Webhook amount/purpose verification and Shipper cash-remittance/direct-Customer-transfer alternatives were hardened | Strengthened |
| UC32 Track/cancel Order | Search/filter, timeline, pending-only cancellation | Adds unified workflow filtering, collapsed tracking, stock release, and exact-value coupon for a paid pending cancellation | Expanded |
| UC33 Product review | Completed-purchase rating/comment | Aligned; ownership and unique review constraints are enforced | Aligned |
| UC34 Fresh Assistant | Customer product/price/expiry/certification assistant | Adds Gemini wording, deterministic fallback, Assistant logs, image-safe Product cards and an Admin mode for Users, Reports, Finance and Monitoring | Expanded |
| UC35 Chat attachment | Upload image/file up to 10 MB | Aligned; signed Cloudinary folders and metadata authorization were hardened | Strengthened |
| UC36 Message reaction | One reaction per user/message | Aligned; mobile reaction control and replace/remove behavior were fixed | Strengthened |
| UC38 Financial report by period | Select week/month/year and view aggregates | Adds arbitrary historical period selection up to today and a surrounding-period comparison chart | Strengthened |
| UC39 Multi-Supplier packing | One consolidated Order grouped by Supplier | Aligned: one payment and one Shipper remain the deliberate domain decision | Aligned |
| UC40 COD/payOS settlement | Customer direct transfer or Shipper cash remittance | Aligned; delivery cannot complete before the matching payOS webhook confirms the required settlement | Strengthened |
| UC41 Paid cancellation coupon | Full-value credit for paid pending cancellation | Aligned and tested for exact amount and idempotency | Aligned |
| UC42 Finance CSV | Export selected period | Adds UTF-8 report metadata, summary/detail sections and period-consistent rows | Strengthened |
| UC43 Share Product/Order | Share eligible entity in chat | Shared Product cards now use the same Cloudinary image resolver; ownership/relationship validation remains enforced | Strengthened |
| UC44 Welcome/loyalty coupons | Two welcome coupons and Order/spend rewards | Now specifies two freeship plus one 10% welcome coupon; delivered-only 500K/1M/2M and 5/10 Order milestones; approved-report 10K; optional 5K-20K large-Order reward; progress UI; used-coupon deletion | Expanded |
| UC45 Email password recovery | Request email and set new password | Adds real SMTP templates, mobile-safe callback and dedicated recovery-session validation | Strengthened |
| UC46 Admin/Manager search/filter | Filters across operational workspaces | Adds Inventory audit filters, unified Order workflow filters, Finance period controls and role-specific Monitoring tabs | Expanded |

## New Use Case Not Separately Defined In The Report

### UC47 - Report A Related User

**Actors:** Customer, Admin, reported user, assigned Manager  
**Goal:** Allow a Customer to report a person who is actually related through an
Order or Chat, while preventing arbitrary account targeting.

**Flow:**

1. Customer searches only related users returned by `list_reportable_users`.
2. Customer submits a `user_report` with the selected `reported_user_id`.
3. Database validation rejects self-reporting or an unrelated user.
4. Admin resolves or rejects the report.
5. Reporter receives the result; a resolved report notifies the reported user.
6. If the report belongs to an Order, its assigned Manager is also notified.
7. A resolved report issues one idempotent 10,000 VND coupon to the reporter.

**Data:** `reports.reported_user_id`, `users`, `chat_room_members`,
`order_manager_assignments`, `notifications`, `coupons`.

## Features That Do Not Need A Separate UC

The following are implementation details or alternative flows of existing UCs:

- Cloudinary Product/avatar storage: UC05, UC24, UC25 and UC35.
- Catalog foreign-key warnings and safe delete: UC04-UC10.
- Coupon progress and policy guide: UC24 and UC44.
- Delivery-not-received complaint: UC16, UC21 and UC22.
- Admin Assistant mode: expanded UC34.
- Meat Product/Batch sample data: data coverage, not a new user goal.
