import { adminClient, currentProfile } from "@/lib/server/supabase";
import { readState } from "@/lib/server/state";
import { runDigest } from "@/lib/server/digest";
import { runJob, dispatch } from "@/lib/server/jobs";
import { JOBS_FNS } from "@/lib/server/schedule";
import { slotOf, jobDef } from "@/lib/jobs";
import { isInternal } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Morning digest. Vercel Cron calls GET daily at 11:00 UTC (Authorization: Bearer CRON_SECRET): every internal user
 * not served yet today gets one email with their own deadlines and tasks; leaders also get company-wide overdue items.
 * The same call then runs any other scheduled job that is due (a second chance each day).
 * POST sends the signed-in user their own digest now (button in Reports).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed", { status: 401 });
  const db = adminClient(); const local = new URL(req.url).searchParams.get("local") === "1";
  const st = await readState(db, "settings").catch(() => null);
  const off = st && st.notify?.digest === false; // switched off in System → Settings
  const digest = off ? { job: "digest", status: "off" } : await runJob(db, "digest", local ? "github" : "cron", async () => runDigest(null, local), { slot: slotOf(jobDef("digest")!, new Date()), budgetMs: 25_000 });
  const rest = await dispatch(db, JOBS_FNS, { trigger: local ? "github" : "cron", budgetMs: 25_000, only: ["backup", "agents", "monitor", "trash", "retry", "reports"] });
  return Response.json({ ok: true, digest, rest });
}
export async function POST() {
  const me = await currentProfile();
  if (!me || !isInternal(me.role)) return new Response("Not allowed", { status: 403 });
  try { return Response.json(await runDigest(me.id)); } catch (e: any) { return new Response(e?.message || "Failed", { status: 501 }); }
}
