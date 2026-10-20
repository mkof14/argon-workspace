import { adminClient, currentProfile } from "@/lib/server/supabase";
import { limit } from "@/lib/server/authz";
import { ORG_DEPTS, ROLES } from "@/config/workspace.config.mjs";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !["owner", "admin"].includes(me.role)) return new Response("Only administrators can invite users", { status: 403 });
  { const lim = await limit(`invite:${me.id}`, 20, 60); if (lim) return lim; }
  const { email, role, company, department, title, manager_id } = await req.json();
  if (department && !(ORG_DEPTS as any[]).some((d) => d.key === department)) return new Response("Unknown department", { status: 400 });
  if (!email || !(role in ROLES) || role === "owner") return new Response("Invalid email or role", { status: 400 });
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback` });
  if (error) return new Response(error.message, { status: 400 });
  let manager: string | null = null;
  if (manager_id) { const { data: m } = await admin.from("profiles").select("id,role,disabled").eq("id", manager_id).maybeSingle(); if (m && !m.disabled && !["partner", "vendor", "investor", "pending"].includes(m.role)) manager = m.id; }
  await admin.from("profiles").update({ role, company: company || null, department: department || null, title: title ? String(title).slice(0, 120) : null, manager_id: manager }).eq("id", data.user.id);
  return Response.json({ ok: true });
}
