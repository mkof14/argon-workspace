import { adminClient } from "@/lib/server/supabase";
import { requireUser, limit } from "@/lib/server/authz";
import { isPrivileged } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Account security (owner / administrator, with the second factor once it is required).
 *  security                 → MFA requirement, and for each person: second factor set up, disabled, sessions ended
 *  revoke {user}            → ends every session of the person now
 *  disable {user, on}       → switches the account off (no sign-in, no data) or back on
 *  reset_mfa {user}         → removes the person's authenticator (lost phone); they set it up again
 *  mfa_required {on}        → owner only: owner/administrator sessions need the second factor
 * The protected owner account cannot be switched off or ended by others.
 */
export async function POST(req: Request) {
  const g = await requireUser("admin"); if (g instanceof Response) return g; const me = g.me;
  { const lim = await limit(`users:${me.id}`, 30, 60); if (lim) return lim; }
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  const target = async () => { const { data } = await db.from("profiles").select("id,email,role,super,disabled").eq("id", String(b.user || "")).maybeSingle(); return data; };
  const guard = (t: any) => !t ? "Not found" : t.super && t.id !== me.id ? "This owner account is protected" : t.role === "owner" && me.role !== "owner" ? "Only an owner can change another owner" : null;

  if (b.action === "security") {
    const [{ data: sec }, { data: ppl }] = await Promise.all([db.from("security_settings").select("mfa_required,updated_at").maybeSingle(), db.from("profiles").select("id,email,full_name,role,disabled,sessions_revoked_at")]);
    const out = [];
    for (const p of ppl || []) {
      const { data: f } = await (db.auth.admin as any).mfa.listFactors({ userId: p.id }).catch(() => ({ data: null }));
      out.push({ ...p, mfa: ((f?.factors || []) as any[]).some((x) => x.status === "verified"), privileged: isPrivileged(p.role) });
    }
    return Response.json({ mfa_required: !!sec?.mfa_required, updated_at: sec?.updated_at || null, me_aal: g.aal, people: out });
  }
  if (b.action === "revoke") {
    const t = await target(); const e = guard(t); if (e) return new Response(e, { status: 403 });
    const { data, error } = await db.rpc("revoke_sessions", { p_user: t!.id }); if (error) return new Response(error.message, { status: 500 });
    await db.from("activity").insert({ record_id: null, section: "admin.users", actor: me.id, action: "sessions_revoked", detail: { user: t!.email } });
    return Response.json({ ok: true, at: data });
  }
  if (b.action === "disable") {
    const t = await target(); const e = guard(t); if (e) return new Response(e, { status: 403 });
    if (t!.id === me.id) return new Response("You cannot switch off your own account", { status: 400 });
    const on = !!b.on;
    const { error } = await db.from("profiles").update({ disabled: on }).eq("id", t!.id); if (error) return new Response(error.message, { status: 500 });
    await db.auth.admin.updateUserById(t!.id, { ban_duration: on ? "876000h" : "none" } as any).catch(() => null);
    if (on) await db.rpc("revoke_sessions", { p_user: t!.id });
    await db.from("activity").insert({ record_id: null, section: "admin.users", actor: me.id, action: on ? "account_disabled" : "account_enabled", detail: { user: t!.email } });
    return Response.json({ ok: true });
  }
  if (b.action === "reset_mfa") {
    const t = await target(); const e = guard(t); if (e) return new Response(e, { status: 403 });
    const { data: f } = await (db.auth.admin as any).mfa.listFactors({ userId: t!.id });
    for (const x of f?.factors || []) await (db.auth.admin as any).mfa.deleteFactor({ id: x.id, userId: t!.id });
    await db.rpc("revoke_sessions", { p_user: t!.id });
    await db.from("activity").insert({ record_id: null, section: "admin.users", actor: me.id, action: "mfa_reset", detail: { user: t!.email } });
    return Response.json({ ok: true, removed: (f?.factors || []).length });
  }
  if (b.action === "mfa_required") {
    if (me.role !== "owner") return new Response("Only the owner", { status: 403 });
    // turning it on from a session that has no second factor would lock this owner out
    if (b.on && g.aal !== "aal2") return new Response("Set up and confirm your own authenticator first (My profile → Sign-in protection), then sign in again with it", { status: 409 });
    const { error } = await db.from("security_settings").update({ mfa_required: !!b.on, updated_at: new Date().toISOString(), updated_by: me.id }).eq("id", true);
    if (error) return new Response(error.message, { status: 500 });
    await db.from("activity").insert({ record_id: null, section: "admin.users", actor: me.id, action: b.on ? "mfa_required_on" : "mfa_required_off", detail: {} });
    return Response.json({ ok: true, mfa_required: !!b.on });
  }
  return new Response("Unknown action", { status: 400 });
}
