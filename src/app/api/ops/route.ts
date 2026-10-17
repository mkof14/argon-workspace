import { sweep } from "@/lib/server/translate";
import { purgeOld } from "@/lib/server/trash";
import { adminClient, currentProfile } from "@/lib/server/supabase";
import { BUCKET, collectData, listFiles, pack } from "@/lib/server/backup";
import { backupJob, monitorJob, opsStatus, reportsJob } from "@/lib/server/ops";
import { runAgents } from "@/lib/server/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Company operations.
 * GET  ?job=backup|monitor|reports|agents|intake|translate|trash  — scheduled run (Authorization: Bearer CRON_SECRET)
 * POST status | backup | monitor | reports  — run now from Administration → System (owner; status also admin)
 * POST data   → gzip JSON of all data for a local copy (owner; export-controlled records only for a US-person owner)
 * POST files  → list of stored files with short-lived download links, for the local copy (owner)
 * POST link {name} → download link for an automatic backup (owner)
 * POST restore {records, comments} → puts back records and comments that no longer exist; never overwrites (owner)
 */
export async function GET(req: Request) {
  const s = process.env.CRON_SECRET;
  if (!s || req.headers.get("authorization") !== `Bearer ${s}`) return new Response("Not allowed", { status: 401 });
  const job = new URL(req.url).searchParams.get("job"); const db = adminClient();
  try {
    if (job === "backup") return Response.json(await backupJob(db));
    if (job === "monitor") return Response.json(await monitorJob(db));
    if (job === "reports") return Response.json(await reportsJob(db));
    if (job === "agents") return Response.json(await runAgents(db));
    if (job === "intake") return Response.json(await runAgents(db, { only: "intake", manual: true }));
    if (job === "translate") return Response.json(await sweep(db, 50000));
    if (job === "trash") return Response.json(await purgeOld(db));
  } catch (e: any) { return new Response(e?.message || "Failed", { status: 500 }); }
  return new Response("Unknown job", { status: 400 });
}

export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !["owner", "admin"].includes(me.role)) return new Response("Only owners and administrators", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  if (b.action === "status") return Response.json(await opsStatus(db));
  if (me.role !== "owner") return new Response("Only the owner", { status: 403 });
  try {
    if (b.action === "backup") return Response.json(await backupJob(db));
    if (b.action === "monitor") return Response.json(await monitorJob(db, { alwaysEmail: !!b.email }));
    if (b.action === "reports") return Response.json(await reportsJob(db, /^\d{4}-\d{2}$/.test(b.period || "") ? b.period : undefined));
    if (b.action === "data") {
      const data = await collectData(db, { controlled: !!me.us_person });
      return new Response(new Uint8Array(pack(data)), { headers: { "Content-Type": "application/gzip", "Cache-Control": "no-store", "x-controlled": String(!!me.us_person) } });
    }
    if (b.action === "files") {
      // Files of export-controlled records only for a US-person owner
      const files = await listFiles(db);
      let allowed = files;
      if (!me.us_person) { const { data: ctl } = await db.from("records").select("id").eq("controlled", true); const bad = new Set((ctl || []).map((r: any) => r.id)); allowed = files.filter((f) => !bad.has(f.path.split("/")[1])); }
      const out: { path: string; size: number; url: string }[] = [];
      for (let i = 0; i < allowed.length; i += 100) {
        const part = allowed.slice(i, i + 100);
        const { data } = await db.storage.from("files").createSignedUrls(part.map((f) => f.path), 900);
        (data || []).forEach((d: any, j: number) => d.signedUrl && out.push({ ...part[j], url: d.signedUrl }));
      }
      return Response.json(out);
    }
    if (b.action === "link") {
      if (!/^auto\/[\w.-]+$/.test(String(b.name || ""))) return new Response("Bad name", { status: 400 });
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(b.name, 600, { download: true });
      if (error) return new Response(error.message, { status: 404 });
      return Response.json({ url: data.signedUrl });
    }
    if (b.action === "restore") {
      const recs = (Array.isArray(b.records) ? b.records : []).filter((r: any) => r && r.id && r.section && r.title).slice(0, 500);
      const cms = (Array.isArray(b.comments) ? b.comments : []).filter((c: any) => c && c.id && c.record_id).slice(0, 2000);
      let added = 0, addedC = 0;
      if (recs.length) {
        const { data: have } = await db.from("records").select("id").in("id", recs.map((r: any) => r.id));
        const exist = new Set((have || []).map((r: any) => r.id));
        const missing = recs.filter((r: any) => !exist.has(r.id)).map((r: any) => ({ id: r.id, section: r.section, title: r.title, status: r.status, data: r.data || {}, company: r.company || null, controlled: !!r.controlled, created_by: r.created_by || null, created_at: r.created_at, updated_at: r.updated_at }));
        if (missing.length) { const { error } = await db.from("records").insert(missing); if (error) return new Response(error.message, { status: 500 }); added = missing.length; }
      }
      if (cms.length) {
        const { data: have } = await db.from("comments").select("id").in("id", cms.map((c: any) => c.id));
        const exist = new Set((have || []).map((c: any) => c.id));
        const missing = cms.filter((c: any) => !exist.has(c.id));
        if (missing.length) { const { error } = await db.from("comments").insert(missing); if (!error) addedC = missing.length; }
      }
      return Response.json({ added, comments: addedC });
    }
  } catch (e: any) { return new Response(e?.message || "Failed", { status: 500 }); }
  return new Response("Unknown action", { status: 400 });
}
