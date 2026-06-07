import { preflight } from "../_shared/cors.ts";
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
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const actor = await requireProfile(request, ["admin"]);
    const body = await readJson<CreateBody | UpdateBody>(request);
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
        .select("user_id,status,roles!inner(role_name)").eq("user_id", body.userId).single();
      if (current.error || !current.data) throw new HttpError(404, "User not found");
      const currentRole = (current.data.roles as unknown as { role_name: string }).role_name;
      const removesCurrentRole = body.role && body.role !== currentRole;
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
      return json(request, { data });
    }

    throw new HttpError(400, "Unsupported action");
  } catch (error) {
    return handleError(request, error);
  }
});
