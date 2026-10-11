import { adminClient } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Uptime check: is the app serving, and can it reach the database and auth?
 * Public, returns no data — only ok/fail per component. 200 when healthy, 503 otherwise.
 * Polled every 15 minutes by the GitHub Actions "Uptime" workflow.
 */
export async function GET() {
  const t0 = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const checks: Record<string, boolean> = { app: true, db: false, auth: false, mail: !!process.env.SMTP_PASS, ai: !!process.env.ANTHROPIC_API_KEY };
  const timeout = (ms: number) => AbortSignal.timeout(ms);
  await Promise.all([
    (async () => { try { const { error } = await adminClient().from("section_access").select("role", { head: true, count: "exact" }).abortSignal(timeout(5000)); checks.db = !error; } catch {} })(),
    (async () => { try { const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon || "" }, signal: timeout(5000), cache: "no-store" }); checks.auth = r.ok; } catch {} })(),
  ]);
  const ok = checks.app && checks.db && checks.auth;
  return Response.json({ ok, checks, ms: Date.now() - t0, at: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
