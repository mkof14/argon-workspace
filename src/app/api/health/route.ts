import { adminClient, currentProfile } from "@/lib/server/supabase";
import { APP_ENV, ENV_REFUSED, RELEASE_AT, RELEASE_SHA, dbAllowed } from "@/lib/env";
import { APP_VERSION, DB_VERSION } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check. Public answer: ok/fail per component and the environment name — no data, no versions, no topology.
 * 200 when healthy, 503 otherwise (also when the deployment refused its database settings: fail closed).
 * Polled every 15 minutes by the GitHub Actions "Uptime" workflow.
 *
 * Authorised answer (Bearer CRON_SECRET, or a signed-in owner/administrator) adds the support view: release
 * (app version, release SHA, deployment time, database version and whether it matches the build), storage, the
 * last run and freshness of every scheduled job, the last backup, queues and dead letters, errors and refused
 * sign-ins of the last 24 h, database connections, and which integrations are configured (yes/no only).
 * Never secrets, keys, hostnames or record data.
 */
const FRESH_HOURS: Record<string, number> = { digest: 26 }; // daily jobs; everything else is expected at least daily too
export async function GET(req: Request) {
  const t0 = Date.now();
  if (!dbAllowed()) {
    const ok = APP_ENV === "preview" && !ENV_REFUSED;
    return Response.json({ ok, env: APP_ENV, database: ENV_REFUSED ? "refused: unsafe or ambiguous settings" : "not connected (preview build)", checks: { app: true }, at: new Date().toISOString() },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  }
  const checks: Record<string, boolean> = { app: true, db: false, auth: false, mail: !!process.env.SMTP_PASS, ai: !!process.env.ANTHROPIC_API_KEY };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const timeout = (ms: number) => AbortSignal.timeout(ms);
  await Promise.all([
    (async () => { try { const { error } = await adminClient().from("section_access").select("role", { head: true, count: "exact" }).abortSignal(timeout(5000)); checks.db = !error; } catch {} })(),
    (async () => { try { const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon || "" }, signal: timeout(5000), cache: "no-store" }); checks.auth = r.ok; } catch {} })(),
  ]);
  const ok = checks.app && checks.db && checks.auth;
  const body: Record<string, unknown> = { ok, env: APP_ENV, checks, ms: Date.now() - t0, at: new Date().toISOString() };

  if (await authorised(req)) {
    const db = adminClient();
    let dbv: number | null = null;
    try { const { data } = await db.rpc("workspace_db_version"); dbv = typeof data === "number" ? data : null; } catch {}
    body.release = { app: APP_VERSION, sha: RELEASE_SHA || null, deployed_at: RELEASE_AT || null, db: dbv, db_expected: DB_VERSION, db_matches: dbv === DB_VERSION, env: APP_ENV };
    body.storage = await storage(db);
    body.scheduler = await scheduler(db);
    try { const { data, error } = await db.rpc("ops_db_stats"); body.operations = error ? { error: "not available" } : data; } catch { body.operations = { error: "not available" }; }
    body.integrations = {
      email: !!process.env.SMTP_PASS, ai: !!process.env.ANTHROPIC_API_KEY, calendar: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      inbound_email: !!process.env.IMAP_HOST, backup_offsite: !!(process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_KEY_ID), backup_passphrase: !!process.env.BACKUP_PASSPHRASE,
      cron_secret: !!process.env.CRON_SECRET,
    };
  }
  return Response.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

async function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  try { const me = await currentProfile(); return !!me && !me.disabled && ["owner", "admin"].includes(me.role); } catch { return false; }
}

/** The private file bucket answers (a listing of one entry, no names returned). */
async function storage(db: any) {
  try { const t = Date.now(); const { error } = await db.storage.from("files").list("", { limit: 1 }); return { ok: !error, ms: Date.now() - t }; } catch { return { ok: false }; }
}

/** Last run of every recurring job, and whether it is fresh (finished successfully within its window). */
async function scheduler(db: any) {
  try {
    const { data, error } = await db.from("job_runs").select("job,status,started_at,finished_at,duration_ms,error").order("started_at", { ascending: false }).limit(500);
    if (error) return { error: "job history not readable" };
    const last: Record<string, any> = {}, lastOk: Record<string, string> = {};
    for (const r of data || []) { last[r.job] ||= r; if (r.status === "completed" && !lastOk[r.job]) lastOk[r.job] = r.finished_at || r.started_at; }
    const now = Date.now();
    return Object.fromEntries(Object.entries(last).map(([job, r]) => {
      const okAt = lastOk[job] ? Date.parse(lastOk[job]) : 0, hours = FRESH_HOURS[job] ?? 26;
      return [job, { last_status: r.status, last_started: r.started_at, duration_ms: r.duration_ms, last_success: lastOk[job] || null, fresh: !!okAt && now - okAt < hours * 3600e3, error: r.status === "completed" ? null : String(r.error || "").slice(0, 160) || null }];
    }));
  } catch { return { error: "job history not readable" }; }
}
