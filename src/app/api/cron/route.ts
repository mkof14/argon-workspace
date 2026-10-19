import { adminClient } from "@/lib/server/supabase";
import { dispatch } from "@/lib/server/jobs";
import { JOBS_FNS } from "@/lib/server/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduler. Called by Vercel Cron (10:00 UTC daily) and, when the CRON_SECRET repository secret is set, by the
 * GitHub "Uptime" workflow every 15 minutes (?trigger=github). Runs every due job inside this function — no calls
 * between functions — and records each attempt in job_runs. Calling it again is always safe: a running job is not
 * started twice and a finished run is not repeated.
 */
export async function GET(req: Request) {
  const s = process.env.CRON_SECRET;
  if (!s || req.headers.get("authorization") !== `Bearer ${s}`) return new Response("Not allowed", { status: 401 });
  const trigger = new URL(req.url).searchParams.get("trigger") === "github" ? "github" : "cron";
  const res = await dispatch(adminClient(), JOBS_FNS, { trigger, budgetMs: 52_000 });
  return Response.json(res);
}
