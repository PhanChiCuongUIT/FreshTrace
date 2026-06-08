import { preflight } from "../_shared/cors.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type Body = { question: string };
type CatalogProduct = {
  product_id: string;
  product_name: string;
  unit: string;
  image_url: string | null;
  certificate: string | null;
  category_name: string;
  batch_id: string;
  expire_date: string;
  current_price: number;
  is_rescue: boolean;
  rescue_discount_percent: number | null;
};
type Recommendation = {
  productId: string;
  name: string;
  unit: string;
  imageUrl: string | null;
  certificate: string | null;
  category: string;
  batchId: string;
  expireDate: string;
  daysRemaining: number;
  currentPrice: number;
  isRescue: boolean;
  rescueDiscountPercent: number | null;
};
type AdminInsight = {
  title: string;
  description: string;
  value: string | number;
  tone?: "green" | "orange" | "red" | "blue" | "gray";
  href?: string;
};

function relatedRoleName(value: unknown): string {
  if (Array.isArray(value)) return String((value[0] as { role_name?: unknown } | undefined)?.role_name ?? "role");
  return String((value as { role_name?: unknown } | null)?.role_name ?? "role");
}

function detectIntent(question: string): string {
  const value = question.toLocaleLowerCase("vi");
  if (/(cheapest|lowest price|least expensive|rẻ nhất|giá thấp nhất|giá rẻ|tiền ít)/.test(value)) return "cheapest";
  if (/(expire soon|nearest expiry|closest date|use soon|cận date|gần hết hạn|hết hạn sớm|date gần nhất|sắp hết hạn)/.test(value)) return "expiring_soon";
  if (/(discount|saving|promotion|rescue|budget|giảm giá|tiết kiệm|ưu đãi|khuyến mãi)/.test(value)) return "saving";
  if (/(freshest|fresh|long shelf|keep longer|long expiry|fresh longer|hạn dài|để lâu|tươi nhất|còn lâu hết hạn)/.test(value)) return "long_shelf_life";
  if (/(organic|vietgap|certified|certificate|chứng nhận|hữu cơ|an toàn)/.test(value)) return "certified";
  return "general";
}

function detectProductType(question: string): { key: string; terms: string[] } | null {
  const value = question.toLocaleLowerCase("vi");
  const groups = [
    { key: "rice", pattern: /(rice|gạo|cơm)/, terms: ["rice", "gạo"] },
    { key: "meat", pattern: /(meat|beef|pork|chicken|thịt|bò|heo|gà)/, terms: ["meat", "beef", "pork", "chicken", "thịt", "bò", "heo", "gà"] },
    { key: "fish", pattern: /(fish|seafood|cá|hải sản)/, terms: ["fish", "seafood", "cá", "hải sản"] },
    { key: "vegetables", pattern: /(vegetable|produce|greens|rau|củ)/, terms: ["vegetable", "vegetables", "produce", "greens", "rau", "củ"] },
    { key: "fruit", pattern: /(fruit|trái cây|hoa quả)/, terms: ["fruit", "fruits", "trái cây", "hoa quả"] },
    { key: "mushroom", pattern: /(mushroom|nấm)/, terms: ["mushroom", "mushrooms", "nấm"] },
    { key: "herb", pattern: /(herb|spice|gia vị|thảo mộc)/, terms: ["herb", "herbs", "spice", "gia vị", "thảo mộc"] },
  ];
  return groups.find((group) => group.pattern.test(value)) ?? null;
}

function detectAdminIntent(question: string): "users" | "reports" | "finance" | "monitoring" | "overview" {
  const value = question.toLocaleLowerCase("vi");
  if (/(user|account|role|customer|manager|shipper|admin|người dùng|tài khoản|vai trò)/.test(value)) return "users";
  if (/(report|complaint|governance|supplier|khiếu nại|báo cáo|phản hồi|nhà cung cấp)/.test(value)) return "reports";
  if (/(finance|revenue|payment|paid|pending|failed|csv|doanh thu|thanh toán|tài chính)/.test(value)) return "finance";
  if (/(monitor|delivery|order|inventory|stock|giám sát|đơn hàng|giao hàng|tồn kho)/.test(value)) return "monitoring";
  return "overview";
}

async function adminAssistant(question: string, userId: string) {
  const admin = adminClient();
  const intent = detectAdminIntent(question);
  const search = question.trim().toLocaleLowerCase("vi");
  const insights: AdminInsight[] = [];

  if (intent === "users" || intent === "overview") {
    const { data: users, error } = await admin.from("users")
      .select("user_id,name,email,status,roles(role_name)")
      .limit(200);
    if (error) throw error;
    const rows = users ?? [];
    const matching = rows.filter((user) => `${user.name} ${user.email} ${user.status} ${relatedRoleName(user.roles)}`.toLocaleLowerCase("vi").includes(search));
    const active = rows.filter((user) => user.status === "active").length;
    const banned = rows.filter((user) => user.status === "banned").length;
    insights.push(
      { title: "Total users", description: "All application profiles by role and status.", value: rows.length, tone: "blue", href: "/admin/users" },
      { title: "Active users", description: "Profiles currently allowed to use FreshTrace.", value: active, tone: "green", href: "/admin/users" },
      { title: "Banned users", description: "Profiles blocked by Admin governance.", value: banned, tone: banned ? "red" : "gray", href: "/admin/users" },
    );
    if (matching.length && intent === "users") {
      matching.slice(0, 5).forEach((user) => insights.push({
        title: user.name,
        description: `${user.email} / ${relatedRoleName(user.roles)} / ${user.status}`,
        value: "match",
        tone: user.status === "active" ? "green" : user.status === "banned" ? "red" : "orange",
        href: "/admin/users",
      }));
    }
  }

  if (intent === "reports" || intent === "overview") {
    const [reports, suppliers] = await Promise.all([
      admin.from("reports").select("report_id,type,status,description,created_at").order("created_at", { ascending: false }).limit(100),
      admin.from("suppliers").select("supplier_id,name,status").limit(100),
    ]);
    if (reports.error ?? suppliers.error) throw reports.error ?? suppliers.error;
    const pendingReports = (reports.data ?? []).filter((item) => ["pending", "processing"].includes(item.status));
    const pendingSuppliers = (suppliers.data ?? []).filter((item) => item.status === "pending");
    insights.push(
      { title: "Open reports", description: "Customer complaints waiting for Admin action.", value: pendingReports.length, tone: pendingReports.length ? "orange" : "green", href: "/admin/reports" },
      { title: "Pending suppliers", description: "Supplier submissions waiting for governance review.", value: pendingSuppliers.length, tone: pendingSuppliers.length ? "orange" : "green", href: "/admin/reports" },
    );
    pendingReports.slice(0, 3).forEach((report) => insights.push({
      title: `${report.type} report`,
      description: report.description?.slice(0, 120) || "No description",
      value: report.status,
      tone: "orange",
      href: `/admin/reports/${report.report_id}`,
    }));
  }

  if (intent === "finance" || intent === "overview") {
    const { data: payments, error } = await admin.from("payments")
      .select("payment_id,method,status,amount,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = payments ?? [];
    const paid = rows.filter((payment) => payment.status === "paid");
    const pending = rows.filter((payment) => payment.status === "pending");
    const failed = rows.filter((payment) => payment.status === "failed");
    const revenue = paid.reduce((sum, payment) => sum + Number(payment.amount), 0);
    insights.push(
      { title: "Paid revenue", description: "Total paid payment value in the latest loaded window.", value: revenue, tone: "green", href: "/admin/finance" },
      { title: "Pending payments", description: "Payments waiting for completion or collection.", value: pending.length, tone: pending.length ? "orange" : "green", href: "/admin/finance" },
      { title: "Failed payments", description: "Payments requiring review.", value: failed.length, tone: failed.length ? "red" : "green", href: "/admin/finance" },
    );
  }

  if (intent === "monitoring" || intent === "overview") {
    const [orders, deliveries, inventory] = await Promise.all([
      admin.from("orders").select("order_id,status,total_amount").limit(200),
      admin.from("deliveries").select("delivery_id,status").limit(200),
      admin.from("inventory").select("inventory_id,quantity_available,quantity_reserved").limit(200),
    ]);
    if (orders.error ?? deliveries.error ?? inventory.error) throw orders.error ?? deliveries.error ?? inventory.error;
    const activeOrders = (orders.data ?? []).filter((order) => !["completed", "cancelled"].includes(order.status));
    const activeDeliveries = (deliveries.data ?? []).filter((delivery) => !["delivered", "failed"].includes(delivery.status));
    const lowStock = (inventory.data ?? []).filter((row) => Number(row.quantity_available) <= 5);
    insights.push(
      { title: "Active orders", description: "Orders not yet completed or cancelled.", value: activeOrders.length, tone: activeOrders.length ? "blue" : "gray", href: "/admin/monitoring" },
      { title: "Active deliveries", description: "Deliveries currently assigned, picked up or delivering.", value: activeDeliveries.length, tone: activeDeliveries.length ? "blue" : "gray", href: "/admin/monitoring" },
      { title: "Low-stock batches", description: "Inventory rows with 5 units or fewer available.", value: lowStock.length, tone: lowStock.length ? "orange" : "green", href: "/admin/monitoring" },
    );
  }

  const answer = insights.length
    ? `I found ${insights.length} admin insight${insights.length === 1 ? "" : "s"} for "${intent}".`
    : "I could not find matching admin data for that question.";

  await admin.from("assistant_logs").insert({
    user_id: userId,
    question: question.trim(),
    answer,
    intent: `admin:${intent}`,
    recommended_product_ids: [],
  });

  return { answer, intent: `admin:${intent}`, recommendations: [], insights };
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["customer", "admin", "manager"]);
    const { question } = await readJson<Body>(request);
    if (!question || question.trim().length < 3) throw new HttpError(400, "Question is too short");

    if (profile.role === "admin") {
      return json(request, await adminAssistant(question, profile.userId));
    }

    const intent = detectIntent(question);
    const productType = detectProductType(question);
    const admin = adminClient();
    const { data: products, error } = await admin.rpc("search_products", {
      p_query: null,
      p_rescue_only: intent === "saving",
      p_limit: 100,
      p_offset: 0,
    });
    if (error) throw error;

    const flattened: Recommendation[] = ((products ?? []) as CatalogProduct[])
      .filter((product) => intent !== "certified" || Boolean(product.certificate))
      .filter((product) => {
        if (!productType) return true;
        const searchable = `${product.product_name} ${product.category_name}`.toLocaleLowerCase("vi");
        return productType.terms.some((term) => searchable.includes(term));
      })
      .map((product) => ({
        productId: product.product_id,
        name: product.product_name,
        unit: product.unit,
        imageUrl: product.image_url,
        certificate: product.certificate,
        category: product.category_name,
        batchId: product.batch_id,
        expireDate: product.expire_date,
        daysRemaining: Math.ceil((new Date(product.expire_date).getTime() - Date.now()) / 86400000),
        currentPrice: product.current_price,
        isRescue: product.is_rescue,
        rescueDiscountPercent: product.rescue_discount_percent,
      }));

    const ranked = flattened.sort((a, b) => {
      if (intent === "long_shelf_life") return b.daysRemaining - a.daysRemaining;
      if (intent === "expiring_soon") return a.daysRemaining - b.daysRemaining;
      if (intent === "cheapest") return a.currentPrice - b.currentPrice;
      if (intent === "saving") return Number(b.rescueDiscountPercent ?? 0) - Number(a.rescueDiscountPercent ?? 0);
      return b.daysRemaining - a.daysRemaining;
    }).slice(0, 5);
    const storedIntent = productType ? `${intent}:${productType.key}` : intent;
    const answer = ranked.length
      ? `I found ${ranked.length} matching ${productType?.key ?? "product"} options in FreshTrace. Results are ranked for the "${intent}" intent.`
      : "No matching products are currently available. Try a broader request.";

    await admin.from("assistant_logs").insert({
      user_id: profile.userId,
      question: question.trim(),
      answer,
      intent: storedIntent,
      recommended_product_ids: ranked.map((item) => item.productId),
    });
    return json(request, { answer, intent: storedIntent, recommendations: ranked });
  } catch (error) {
    return handleError(request, error);
  }
});
