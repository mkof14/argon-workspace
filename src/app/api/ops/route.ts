import { adminClient } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/authz";
import { collectData, listFiles, pack, listBackups } from "@/lib/server/backup";
import { opsStatus, operationsChecks, monitorJob } from "@/lib/server/ops";
import { runJob, jobHealth } from "@/lib/server/jobs";
import { JOBS_FNS } from "@/lib/server/schedule";
import { requeue } from "@/lib/server/automation";
import { resolveDelivery } from "@/lib/server/outbound";
import { s3Config, presignGet } from "@/lib/server/s3";
import { jobDef, slotOf } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Company operations.
 * GET  ?job=<id>  — one scheduled job now (Authorization: Bearer CRON_SECRET); same lock and history as the scheduler
 * POST (owner/administrator, with the second factor once it is required):
 *   status · ops (jobs, missed runs, dead letters, deliveries to check, problems)
 *   run {job} · revive {job, slot} · requeue {id} · delivery {id, arrived}
 *   backup | monitor | reports (= run) · data · files · link {name} · restore {records, comments} (owner)
 */
export async function GET(req: Request) {
  const s = process.env.CRON_SECRET;
  if (!s || req.headers.get("authorization") !== `Bearer ${s}`) return new Response("Not allowed", { status: 401 });
  const job = new URL(req.url).searchParams.get("job") || ""; const def = jobDef(job);
  if (!def || !JOBS_FNS[job]) return new Response("Unknown job", { status: 400 });
  const r = await runJob(adminClient(), job, "cron-job", JOBS_FNS[job], { slot: slotOf(def, new Date()) });
  return Response.json(r, { status: r.status === "failed" ? 500 : 200 });
}

export async function POST(req: Request) {
  const g = await requireUser("admin"); if (g instanceof Response) return g; const me = g.me;
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  try {
    if (b.action === "status") return Response.json(await opsStatus(db));
    if (b.action === "ops") {
      const [health, problems, dead, deliveries, retrying, backups] = await Promise.all([
        jobHealth(db), operationsChecks(db),
        db.from("automation_queue").select("id,agent,title,status,attempts,last_error,finished_at,updated_at,controlled").in("status", ["dead", "failed"]).order("updated_at", { ascending: false }).limit(50).then((r: any) => r.data || []),
        db.from("outbound_messages").select("id,to_addr,subject,status,attempts,last_error,updated_at,queue_id").in("status", ["uncertain", "failed", "sending"]).order("updated_at", { ascending: false }).limit(50).then((r: any) => r.data || []),
        db.from("automation_queue").select("id,agent,title,status,attempts,next_attempt_at,last_error").in("status", ["retrying", "processing"]).order("updated_at", { ascending: false }).limit(50).then((r: any) => r.data || []),
        listBackups(db).catch(() => []),
      ]);
      const hide = (x: any) => (x.controlled && !me.us_person ? { ...x, title: "US-persons-only record", last_error: "Details hidden" } : x);
      return Response.json({ ...health, problems, dead: dead.map(hide), deliveries: deliveries.map((d: any) => ({ ...d, to_addr: d.to_addr.replace(/^(.).*(@.*)$/, "$1…$2") })), retrying, backups: backups.slice(0, 20), offsite: !!s3Config(), passphrase: !!process.env.BACKUP_PASSPHRASE });
    }
    const run = (job: string) => JOBS_FNS[job] ? runJob(db, job, `manual:${me.email}`, JOBS_FNS[job]) : Promise.resolve({ job, status: "unknown" });
    if (b.action === "run") return Response.json(await run(String(b.job || "")));
    if (b.action === "backup" || b.action === "monitor" || b.action === "reports") {
      if (me.role !== "owner") return new Response("Only the owner", { status: 403 });
      if (b.action === "monitor") return Response.json(await runJob(db, "monitor", `manual:${me.email}`, () => monitorJob(db, { alwaysEmail: !!b.email })));
      return Response.json(await run(b.action));
    }
    if (b.action === "revive") { const { data, error } = await db.rpc("job_revive", { p_job: String(b.job || ""), p_slot: b.slot ?? null }); if (error) throw new Error(error.message); return Response.json({ cleared: data }); }
    if (b.action === "requeue") return Response.json(await requeue(db, String(b.id || ""), me.email));
    if (b.action === "delivery") {
      const d = await resolveDelivery(db, String(b.id || ""), !!b.arrived, me.email);
      if (d.queue_id) {
        if (b.arrived) await db.from("automation_queue").update({ status: "completed", result: `delivery confirmed by ${me.email}`, last_error: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", d.queue_id).in("status", ["failed", "dead"]);
        else await requeue(db, d.queue_id, me.email).catch(() => null); // one more send, through the same delivery record
      }
      return Response.json({ ok: true });
    }
    if (me.role !== "owner") return new Response("Only the owner", { status: 403 });
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
      if (!/^db\/AGRON_Workspace_[\w.-]+\.agronbackup$/.test(String(b.name || ""))) return new Response("Bad name", { status: 400 });
      const c = s3Config(); if (c) return Response.json({ url: presignGet(c, b.name, 600) });
      const { data, error } = await db.storage.from("backups").createSignedUrl(`v3/${b.name}`, 600, { download: true });
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
