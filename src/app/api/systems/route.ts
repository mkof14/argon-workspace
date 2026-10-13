import { currentProfile, userClient } from "@/lib/server/supabase";
import { timedGet } from "@/lib/server/safefetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Technical systems.
 *  check  {ids?} → opens each system's health or main link (public https only), records status and response time
 *  github {repo} → public repository facts: last commit, open issues and pull requests, latest CI run
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending" || ["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const sb = await userClient();

  if (b.action === "check") {
    let q = sb.from("records").select("id,title,status,data").eq("section", "technical.systems").neq("status", "Retired");
    if (Array.isArray(b.ids) && b.ids.length) q = q.in("id", b.ids.slice(0, 40));
    const { data: rows } = await q.limit(40);
    const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const out = await Promise.all((rows || []).map(async (r: any) => {
      const url = r.data?.health_url || r.data?.url;
      if (!url) return { id: r.id, status: r.status, skipped: true };
      const res = await timedGet(url);
      const status = !res.ok ? (res.status >= 500 || !res.status ? "Down" : "Degraded") : res.ms > 3000 ? "Degraded" : "Operational";
      const last = `${now} · ${res.ok ? `HTTP ${res.status}` : res.error || `HTTP ${res.status}`}`;
      // Saved only where the user may edit; everyone still sees the live result
      await sb.from("records").update({ status, data: { ...r.data, last_check: last, latency: res.ms }, updated_at: new Date().toISOString() }).eq("id", r.id);
      return { id: r.id, status, http: res.status, ms: res.ms, error: res.error || null, last_check: last };
    }));
    return Response.json(out);
  }

  if (b.action === "github") {
    const m = String(b.repo || "").match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git|\/|$)/i) || String(b.repo || "").match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) return new Response("Give the repository as owner/name or its GitHub link", { status: 400 });
    const base = `https://api.github.com/repos/${m[1]}/${m[2]}`;
    const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AGRON-Workspace" };
    if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const get = (p: string) => fetch(base + p, { headers: h, cache: "no-store" }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? "Repository not found or private (add GITHUB_TOKEN in Vercel)" : r.status === 403 ? "GitHub limit reached, try in an hour" : `GitHub ${r.status}`))));
    try {
      const [repo, commits, runs, pulls] = await Promise.all([get(""), get("/commits?per_page=1"), get("/actions/runs?per_page=1").catch(() => ({ workflow_runs: [] })), get("/pulls?state=open&per_page=100").catch(() => [])]);
      const c = commits?.[0], run = runs?.workflow_runs?.[0];
      return Response.json({
        name: repo.full_name, private: repo.private, url: repo.html_url, branch: repo.default_branch,
        open_issues: Math.max(0, (repo.open_issues_count || 0) - (pulls?.length || 0)), open_prs: pulls?.length || 0,
        last_commit: c ? { date: c.commit?.author?.date, message: String(c.commit?.message || "").split("\n")[0].slice(0, 140), author: c.commit?.author?.name } : null,
        ci: run ? { name: run.name, status: run.status, conclusion: run.conclusion, date: run.updated_at, url: run.html_url } : null,
      });
    } catch (e: any) { return new Response(e.message, { status: 502 }); }
  }
  return new Response("Unknown action", { status: 400 });
}
