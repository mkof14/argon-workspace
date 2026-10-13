import { adminClient, currentProfile } from "@/lib/server/supabase";
import { scan } from "@/lib/server/domainscan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Security tools.
 *  scan   {domains}     → email protection (SPF, DMARC, Google DKIM, MX), HTTPS certificate expiry and security headers per domain
 *  users                → Workspace access review: every account with role, US-person flag and last sign-in (owner/admin only)
 *  screen {name,country}→ restricted-party screening against the US Consolidated Screening List (needs CSL_API_KEY); links otherwise
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending" || ["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  const b = await req.json().catch(() => ({}));

  if (b.action === "scan") {
    const list = (Array.isArray(b.domains) ? b.domains : []).map((x: any) => String(x).trim()).filter((x: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))).slice(0, 6);
    if (!list.length) return new Response("Add a domain such as agron1.com", { status: 400 });
    return Response.json(await Promise.all(list.map(scan)));
  }

  if (b.action === "users") {
    if (!["owner", "admin"].includes(me.role)) return new Response("Only owners and administrators", { status: 403 });
    const admin = adminClient();
    const [{ data: profiles }, { data: auth }] = await Promise.all([admin.from("profiles").select("id,email,full_name,role,us_person,company,created_at"), admin.auth.admin.listUsers({ perPage: 1000 })]);
    const seen = new Map((auth?.users || []).map((u: any) => [u.id, u.last_sign_in_at]));
    const now = Date.now();
    return Response.json((profiles || []).map((p: any) => {
      const last = seen.get(p.id) || null; const days = last ? Math.floor((now - Date.parse(last)) / 864e5) : null;
      const flags: string[] = [];
      if (p.role === "pending") flags.push("Waiting for a role");
      if (last === null) flags.push("Never signed in");
      else if (days! > 60) flags.push(`No sign-in for ${days} days`);
      if (["partner", "vendor", "investor"].includes(p.role)) flags.push("External account");
      if (!p.us_person && !["partner", "vendor", "investor", "pending"].includes(p.role)) flags.push("Not a US person: no access to controlled data");
      return { email: p.email, name: p.full_name, role: p.role, us_person: !!p.us_person, company: p.company, last_sign_in: last, days, flags };
    }).sort((a: any, z: any) => z.flags.length - a.flags.length));
  }

  if (b.action === "screen") {
    const name = String(b.name || "").trim().slice(0, 200), country = String(b.country || "").trim();
    if (name.length < 2) return new Response("Enter the party name", { status: 400 });
    const key = process.env.CSL_API_KEY;
    if (!key) return Response.json({ configured: false });
    const cc = /^[A-Z]{2}$/i.test(country) ? `&countries=${country.toUpperCase()}` : "";
    const r = await fetch(`https://data.trade.gov/consolidated_screening_list/v1/search?name=${encodeURIComponent(name)}&fuzzy_name=true&size=10${cc}`, { headers: { "subscription-key": key }, cache: "no-store" });
    if (!r.ok) return new Response(`Screening service answered ${r.status}: check CSL_API_KEY`, { status: 502 });
    const j = await r.json();
    const hits = (j.results || []).map((x: any) => ({ name: x.name, source: x.source, score: x.score ?? null, programs: (x.programs || []).join(", "), countries: [...new Set((x.addresses || []).map((a: any) => a.country).filter(Boolean))].join(", "), url: x.source_information_url || "" }));
    return Response.json({ configured: true, total: j.total || hits.length, hits, checked_at: new Date().toISOString() });
  }
  return new Response("Unknown action", { status: 400 });
}
