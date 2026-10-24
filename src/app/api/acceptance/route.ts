import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { acceptancePackage, recordSnapshot, releaseIdentity } from "@/lib/server/acceptance";
import { scrub } from "@/lib/acceptance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * System → Acceptance Evidence (P9-R2). Owners and administrators only: the evidence is sensitive operational
 * information. Everything is computed from the append-only evidence store and the live system state.
 *   GET                       the page (the package as JSON)
 *   GET ?history=<check id>   every recorded execution of one check, newest first (superseded ones included)
 *   POST {op: "export"}       records a system snapshot, then returns agron-acceptance.json and agron-acceptance.md
 *   POST {op: "attest" | "close" | "reopen" | "comment" | "setting", …}   owner operations; the database checks that
 *                             the caller is an owner (a System Administrator gains no business authority here)
 */
async function gate() {
  const me = await currentProfile().catch(() => null);
  if (!me || !["owner", "admin"].includes(me.role)) return null;
  return me;
}
const deny = () => Response.json({ error: "Only owners and administrators see acceptance evidence" }, { status: 403, headers: { "Cache-Control": "no-store" } });
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const me = await gate(); if (!me) return deny();
  const db = adminClient(); const u = new URL(req.url);
  const h = u.searchParams.get("history");
  if (h) {
    const { data, error } = await db.from("acceptance_evidence").select("*").eq("check_id", h).order("seq", { ascending: false }).limit(200);
    if (error) return json({ error: error.message }, 500);
    return json({ check: h, rows: scrub(data || []) });
  }
  try { const p = await acceptancePackage(db); return json({ ...p.json, me: { role: me.role } }); }
  catch (e: any) { return json({ error: e.message || "not available" }, 500); }
}

export async function POST(req: Request) {
  const me = await gate(); if (!me) return deny();
  const body = await req.json().catch(() => ({}));
  const db = adminClient();
  if (body.op === "export") {
    try {
      await recordSnapshot(db);
      const p = await acceptancePackage(db);
      return json({ json: p.json, md: p.md, files: ["agron-acceptance.json", "agron-acceptance.md"] });
    } catch (e: any) { return json({ error: e.message || "export failed" }, 500); }
  }
  // owner operations run as the signed-in person: the database refuses anyone who is not an owner
  const sb = await userClient(); let r: any;
  if (body.op === "attest") {
    const id = await releaseIdentity(db);
    r = await sb.rpc("acceptance_attest", { p_check: String(body.check || ""), p_status: String(body.status || ""), p_environment: String(body.environment || ""),
      p_identity: { app_version: id.app_version, git_sha: id.git_sha, db_version: id.db_version, migration_hash: id.migration_hash }, p_summary: String(body.summary || "").slice(0, 2000),
      p_metrics: scrub(body.metrics || {}), p_ref: String(body.ref || "").slice(0, 300) });
  } else if (body.op === "close") r = await sb.rpc("acceptance_close_action", { p_action: Number(body.action), p_evidence: Array.isArray(body.evidence) ? body.evidence.map(String) : [], p_note: body.note ? String(body.note).slice(0, 2000) : null });
  else if (body.op === "reopen") r = await sb.rpc("acceptance_reopen_action", { p_action: Number(body.action), p_note: body.note ? String(body.note).slice(0, 2000) : null });
  else if (body.op === "comment") r = await sb.rpc("acceptance_comment", { p_target: String(body.target || "general").slice(0, 100), p_body: String(body.body || "").slice(0, 4000) });
  else if (body.op === "setting") r = await sb.rpc("acceptance_setting_save", { p_key: String(body.key || ""), p_value: body.value || {} });
  else return json({ error: "unknown operation" }, 400);
  if (r.error) return json({ error: r.error.message }, r.error.code === "42501" ? 403 : 400);
  return json({ ok: true, result: r.data });
}
