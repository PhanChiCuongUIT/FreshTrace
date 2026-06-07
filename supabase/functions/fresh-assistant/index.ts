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

function detectIntent(question: string): string {
  const value = question.toLocaleLowerCase("vi");
  if (/(cheapest|lowest price|least expensive|rẻ nhất|giá thấp nhất)/.test(value)) return "cheapest";
  if (/(expire soon|nearest expiry|closest date|use soon|cận date|gần hết hạn|hết hạn sớm|date gần nhất)/.test(value)) return "expiring_soon";
  if (/(discount|saving|promotion|rescue|budget|giảm giá|tiết kiệm)/.test(value)) return "saving";
  if (/(freshest|fresh|long shelf|keep longer|long expiry|fresh longer|hạn dài|để lâu)/.test(value)) return "long_shelf_life";
  if (/(organic|vietgap|certified|certificate|chứng nhận|hữu cơ)/.test(value)) return "certified";
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

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const profile = await requireProfile(request, ["customer", "admin", "manager"]);
    const { question } = await readJson<Body>(request);
    if (!question || question.trim().length < 3) throw new HttpError(400, "Question is too short");

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
