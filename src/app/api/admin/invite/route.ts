import { adminClient, currentProfile } from "@/lib/server/supabase";
import { ROLES } from "@/config/workspace.config.mjs";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !["owner", "admin"].includes(me.role)) return new Response("Only administrators can invite users", { status: 403 });
  const { email, role, company } = await req.json();
  if (!email || !(role in ROLES) || role === "owner") return new Response("Invalid email or role", { status: 400 });
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback` });
  if (error) return new Response(error.message, { status: 400 });
  await admin.from("profiles").update({ role, company: company || null }).eq("id", data.user.id);
  return Response.json({ ok: true });
}
