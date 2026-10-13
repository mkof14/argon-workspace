export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily scheduler (Vercel Cron, 10:00 UTC): monitoring every day, backup on Mondays, reports on the 1st. Each job runs as its own call. */
export async function GET(req: Request) {
  const s = process.env.CRON_SECRET;
  if (!s || req.headers.get("authorization") !== `Bearer ${s}`) return new Response("Not allowed", { status: 401 });
  const origin = new URL(req.url).origin; const now = new Date();
  const jobs = ["monitor", ...(now.getUTCDay() === 1 ? ["backup"] : []), ...(now.getUTCDate() === 1 ? ["reports"] : [])];
  const res = await Promise.all(jobs.map((j) => fetch(`${origin}/api/ops?job=${j}`, { headers: { authorization: `Bearer ${s}` }, cache: "no-store" }).then(async (r) => ({ job: j, status: r.status, body: (await r.text()).slice(0, 300) })).catch((e) => ({ job: j, status: 0, body: String(e) }))));
  return Response.json(res);
}
