import { preflight } from "../_shared/cors.ts";
import { sendMail } from "../_shared/email.ts";
import { handleError, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, requireProfile } from "../_shared/supabase.ts";

type CreateBody = {
  action: "create";
  email: string;
  password: string;
  name: string;
  role: "admin" | "manager" | "employee" | "customer";
  phone?: string;
  address?: string;
};

type UpdateBody = {
  action: "update";
  userId: string;
  role?: "admin" | "manager" | "employee" | "customer";
  status?: "active" | "inactive" | "banned";
  reason?: string;
};

type DeleteBody = {
  action: "delete";
  userId: string;
};

type Body = CreateBody | UpdateBody | DeleteBody;

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatContact(name: string | null | undefined, email: string | null | undefined) {
  const safeName = (name || "FreshTrace Admin").trim();
  const safeEmail = (email || "").trim();
  return safeEmail ? `${safeName} <${safeEmail}>` : safeName;
}

function statusMailHtml(
  name: string,
  status: "inactive" | "banned",
  reason: string,
  actor: { name: string | null; email: string | null },
  supportEmail: string,
) {
  const title = status === "banned" ? "Your FreshTrace account has been banned" : "Your FreshTrace account has been set to inactive";
  const description = status === "banned"
    ? "This action is permanent. The account cannot be restored to active or inactive status."
    : "Your account is temporarily inactive. Please reply to the admin below to request reactivation if you believe this should be reviewed.";
  const safeName = escapeHtml(name || "FreshTrace user");
  const safeReason = escapeHtml(reason);
  const safeActor = escapeHtml(formatContact(actor.name, actor.email));
  const safeActorEmail = escapeHtml(actor.email || supportEmail);
  const safeSupportEmail = escapeHtml(supportEmail);
  const contactAction = status === "inactive"
    ? "to request reactivation"
    : "if you need clarification or want to appeal this decision";
  return `<!doctype html><html><body style="margin:0;background:#f6faf3;font-family:Arial,sans-serif;color:#17301f">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6faf3;padding:28px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dfe8dc;border-radius:22px;overflow:hidden">
          <tr><td style="background:#0f6b45;padding:24px 28px;color:#fff">
            <h1 style="margin:0;font-size:24px;line-height:1.25">${title}</h1>
          </td></tr>
          <tr><td style="padding:28px">
            <p style="font-size:16px;line-height:1.6;margin:0 0 16px">Hello ${safeName},</p>
            <p style="font-size:15px;line-height:1.6;margin:0 0 18px">${description}</p>
            <div style="border:1px solid #e4ece1;border-radius:16px;background:#f8fbf6;padding:16px">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#0f6b45">Admin reason</p>
              <p style="margin:0;font-size:15px;line-height:1.6">${safeReason}</p>
            </div>
            <div style="border:1px solid #d9eadf;border-radius:16px;background:#fff;padding:16px;margin-top:16px">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#0f6b45">Admin contact</p>
              <p style="margin:0 0 10px;font-size:15px;line-height:1.6">This account action was performed by: <strong>${safeActor}</strong>.</p>
              <p style="margin:0;font-size:15px;line-height:1.6">Please reply to this email or contact <a href="mailto:${safeActorEmail}" style="color:#0f6b45;font-weight:700">${safeActorEmail}</a> ${contactAction}.</p>
            </div>
            <p style="font-size:14px;line-height:1.6;color:#657066;margin:18px 0 0">For additional support, contact <a href="mailto:${safeSupportEmail}" style="color:#0f6b45;font-weight:700">${safeSupportEmail}</a>.</p>
            <p style="font-size:13px;line-height:1.6;color:#657066;margin:22px 0 0">FreshTrace Governance Team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const actor = await requireProfile(request, ["admin"]);
    const body = await readJson<Body>(request);
    const admin = adminClient();

    if (body.action === "create") {
      if (!body.email?.includes("@") || body.password?.length < 8 || body.name?.trim().length < 2) {
        throw new HttpError(400, "Valid email, name and password of at least 8 characters are required");
      }
      const { data: role, error: roleError } = await admin.from("roles")
        .select("role_id").eq("role_name", body.role).single();
      if (roleError || !role) throw new HttpError(400, "Invalid role");

      const { data: created, error: authError } = await admin.auth.admin.createUser({
        email: body.email.trim().toLowerCase(),
        password: body.password,
        email_confirm: true,
        user_metadata: { name: body.name.trim() },
      });
      if (authError || !created.user) throw new HttpError(400, authError?.message ?? "Could not create user");

      const { data: profile, error: profileError } = await admin.from("users").update({
        role_id: role.role_id,
        name: body.name.trim(),
        phone: body.phone?.trim() || null,
        address: body.address?.trim() || null,
      }).eq("auth_user_id", created.user.id).select("user_id,email,name,status").single();
      if (profileError || !profile) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new HttpError(500, "Could not create user profile");
      }
      return json(request, { data: profile }, 201);
    }

    if (body.action === "update") {
      if (!body.userId) throw new HttpError(400, "userId is required");
      const current = await admin.from("users")
        .select("user_id,auth_user_id,role_id,email,name,status,roles!inner(role_name)").eq("user_id", body.userId).single();
      if (current.error || !current.data) throw new HttpError(404, "User not found");
      const currentRole = (current.data.roles as unknown as { role_name: string }).role_name;
      const removesCurrentRole = body.role && body.role !== currentRole;
      if (current.data.status === "banned" && body.status && body.status !== "banned") {
        throw new HttpError(409, "Banned accounts cannot be restored to active or inactive status");
      }
      if ((body.status === "inactive" || body.status === "banned") && !body.reason?.trim()) {
        throw new HttpError(400, "A reason is required when banning or inactivating a user");
      }
      const disablesAccount = body.status && body.status !== "active";
      if (body.userId === actor.userId && (removesCurrentRole || disablesAccount)) {
        throw new HttpError(409, "Admin cannot demote or disable the current account");
      }
      if (currentRole === "admin" && (removesCurrentRole || disablesAccount)) {
        const activeAdmins = await admin.from("users")
          .select("user_id,roles!inner(role_name)", { count: "exact", head: true })
          .eq("status", "active").eq("roles.role_name", "admin");
        if ((activeAdmins.count ?? 0) <= 1) throw new HttpError(409, "The last active admin cannot be changed");
      }
      if ((removesCurrentRole || disablesAccount) && currentRole === "employee") {
        const active = await admin.from("deliveries").select("delivery_id", { count: "exact", head: true })
          .eq("employee_id", body.userId).in("status", ["assigned", "picked_up", "delivering"]);
        if ((active.count ?? 0) > 0) throw new HttpError(409, "Reassign active deliveries before changing this employee");
      }
      if ((removesCurrentRole || disablesAccount) && currentRole === "manager") {
        const active = await admin.from("order_manager_assignments")
          .select("order_id,orders!inner(status)", { count: "exact", head: true })
          .eq("manager_id", body.userId).in("orders.status", ["pending", "confirmed", "preparing", "delivering"]);
        if ((active.count ?? 0) > 0) throw new HttpError(409, "Reassign active orders before changing this manager");
      }
      if ((removesCurrentRole || disablesAccount) && currentRole === "customer") {
        const active = await admin.from("orders").select("order_id", { count: "exact", head: true })
          .eq("user_id", body.userId).in("status", ["pending", "confirmed", "preparing", "delivering"]);
        if ((active.count ?? 0) > 0) throw new HttpError(409, "Customer has open orders and cannot change role or status");
      }

      const updates: Record<string, unknown> = {};
      if (body.status) updates.status = body.status;
      if (body.role) {
        const { data: role, error: roleError } = await admin.from("roles")
          .select("role_id").eq("role_name", body.role).single();
        if (roleError || !role) throw new HttpError(400, "Invalid role");
        updates.role_id = role.role_id;
      }
      if (!Object.keys(updates).length) throw new HttpError(400, "No update was provided");

      const { data, error } = await admin.from("users").update(updates)
        .eq("user_id", body.userId)
        .select("user_id,email,name,status,roles(role_name)")
        .single();
      if (error || !data) throw new HttpError(404, "User not found");
      if ((body.status === "inactive" || body.status === "banned") && current.data.email) {
        try {
          const actorProfile = await admin.from("users")
            .select("name,email")
            .eq("user_id", actor.userId)
            .single();
          if (actorProfile.error || !actorProfile.data) {
            throw new HttpError(404, "Acting admin profile was not found");
          }
          const supportEmail = Deno.env.get("SUPPORT_EMAIL")?.trim()
            || Deno.env.get("SMTP_ADMIN_EMAIL")?.trim()
            || actorProfile.data.email
            || "support@freshtrace.online";
          const replyTo = actorProfile.data.email || supportEmail;
          const actorContact = formatContact(actorProfile.data.name, actorProfile.data.email);
          const statusText = body.status === "banned" ? "banned" : "inactive";
          const contactAction = body.status === "inactive"
            ? "to request reactivation"
            : "if you need clarification or want to appeal this decision";
          await sendMail({
            to: current.data.email,
            subject: body.status === "banned" ? "FreshTrace account banned" : "FreshTrace account inactive",
            html: statusMailHtml(current.data.name, body.status, body.reason!.trim(), actorProfile.data, supportEmail),
            text: `Hello ${current.data.name || "FreshTrace user"}, your FreshTrace account is now ${statusText}. Reason: ${body.reason!.trim()}. This account action was performed by: ${actorContact}. Please reply to this admin ${contactAction}. For additional support, contact ${supportEmail}.`,
            replyTo,
          });
        } catch (mailError) {
          const rollback = await admin.from("users").update({
            status: current.data.status,
            role_id: current.data.role_id,
          }).eq("user_id", body.userId);
          if (rollback.error) {
            console.error("Could not roll back user governance update after email failure", rollback.error);
          }
          throw new HttpError(
            502,
            `Status email could not be sent; the account change was rolled back. ${mailError instanceof Error ? mailError.message : String(mailError)}`,
          );
        }
      }
      return json(request, { data });
    }

    if (body.action === "delete") {
      if (!body.userId) throw new HttpError(400, "userId is required");
      if (body.userId === actor.userId) throw new HttpError(409, "Admin cannot delete the current account");
      const current = await admin.from("users")
        .select("user_id,auth_user_id,status,email,name,roles!inner(role_name)").eq("user_id", body.userId).single();
      if (current.error || !current.data) throw new HttpError(404, "User not found");
      if (current.data.status !== "banned") throw new HttpError(409, "Only banned users can be deleted");
      const currentRole = (current.data.roles as unknown as { role_name: string }).role_name;
      if (currentRole === "admin") {
        throw new HttpError(409, "Admin accounts cannot be deleted from this workflow");
      }
      const openOrders = await admin.from("orders").select("order_id", { count: "exact", head: true })
        .eq("user_id", body.userId).in("status", ["pending", "confirmed", "preparing", "delivering"]);
      if ((openOrders.count ?? 0) > 0) throw new HttpError(409, "User has open orders and cannot be deleted");
      const activeDeliveries = await admin.from("deliveries").select("delivery_id", { count: "exact", head: true })
        .eq("employee_id", body.userId).in("status", ["assigned", "picked_up", "delivering"]);
      if ((activeDeliveries.count ?? 0) > 0) throw new HttpError(409, "User has active deliveries and cannot be deleted");

      const deleted = await admin.auth.admin.deleteUser(current.data.auth_user_id);
      if (deleted.error) throw new HttpError(409, deleted.error.message);
      return json(request, { data: { userId: body.userId, deleted: true } });
    }

    throw new HttpError(400, "Unsupported action");
  } catch (error) {
    return handleError(request, error);
  }
});
