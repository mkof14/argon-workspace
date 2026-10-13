import { resolveTxt, resolveMx } from "node:dns/promises";
import { connect } from "node:tls";
import { adminClient, currentProfile } from "@/lib/server/supabase";
import { publicUrl } from "@/lib/server/safefetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Security tools.
 *  scan   {domains}     → email protection (SPF, DMARC, Google DKIM, MX), HTTPS certificate expiry and security headers per domain
 *  users                → Workspace access review: every account with role, US-person flag and last sign-in (owner/admin only)
 *  screen {name,country}→ restricted-party screening against the US Consolidated Screening List (needs CSL_API_KEY); links otherwise
 */
type Check = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string };
const txt = async (name: string) => { try { return (await resolveTxt(name)).map((r) => r.join("")); } catch { return []; } };

async function certDays(host: string): Promise<{ days: number; issuer: string } | null> {
  return new Promise((res) => {
    const s = connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
      const c = s.getPeerCertificate(); s.end();
      if (!c?.valid_to) return res(null);
      res({ days: Math.floor((Date.parse(c.valid_to) - Date.now()) / 864e5), issuer: String((c.issuer as any)?.O || (c.issuer as any)?.CN || "") });
    });
    s.on("error", () => res(null)); s.on("timeout", () => { s.destroy(); res(null); });
  });
}

async function scan(domain: string): Promise<{ domain: string; checks: Check[] }> {
  const d = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const checks: Check[] = [];
  if (await publicUrl(`https://${d}`)) return { domain: d, checks: [{ id: "dns", label: "Domain", status: "fail", detail: "Not a public domain" }] };
  // Email protection lives on the base domain (agron1.com for workspace.agron1.com)
  const base = d.split(".").slice(-2).join(".");
  const [spf, dmarc, dkim, mx] = await Promise.all([txt(base), txt(`_dmarc.${base}`), txt(`google._domainkey.${base}`), resolveMx(base).catch(() => [])]);
  const spfRec = spf.find((t) => /^v=spf1/i.test(t));
  checks.push({ id: "mx", label: "Mail servers (MX)", status: mx.length ? "pass" : "warn", detail: mx.length ? mx.map((m) => m.exchange).slice(0, 3).join(", ") : "No MX records: the domain cannot receive email" });
  checks.push({ id: "spf", label: "SPF (who may send our email)", status: !spfRec ? "fail" : /[-~]all\b/.test(spfRec) ? "pass" : "warn", detail: spfRec || "Missing: anyone can send email pretending to be this domain" });
  const dm = dmarc.find((t) => /^v=DMARC1/i.test(t)); const pol = dm?.match(/p=(\w+)/i)?.[1]?.toLowerCase();
  checks.push({ id: "dmarc", label: "DMARC (what to do with fakes)", status: !dm ? "fail" : pol === "reject" || pol === "quarantine" ? "pass" : "warn", detail: dm ? `${dm}${pol === "none" ? " — monitoring only; move to quarantine or reject" : ""}` : "Missing: fake emails from this domain are not blocked" });
  checks.push({ id: "dkim", label: "DKIM (Google Workspace signature)", status: dkim.some((t) => /v=DKIM1|k=rsa/i.test(t)) ? "pass" : "warn", detail: dkim.length ? "google._domainkey found" : "Google selector not found: turn on DKIM in Google Admin → Apps → Gmail → Authenticate email" });
  const cert = await certDays(d);
  checks.push({ id: "tls", label: "HTTPS certificate", status: !cert ? "fail" : cert.days < 14 ? "fail" : cert.days < 30 ? "warn" : "pass", detail: cert ? `${cert.days} days left · ${cert.issuer}` : "No valid certificate on port 443" });
  try {
    const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(`https://${d}`, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "AGRON-Workspace-SecurityCheck/1.0" }, cache: "no-store" }); clearTimeout(id);
    const h = (k: string) => r.headers.get(k) || "";
    const hsts = h("strict-transport-security"); const csp = h("content-security-policy");
    checks.push({ id: "hsts", label: "HSTS (always HTTPS)", status: /max-age=(\d+)/.test(hsts) && Number(hsts.match(/max-age=(\d+)/)![1]) >= 15552000 ? "pass" : hsts ? "warn" : "fail", detail: hsts || "Missing Strict-Transport-Security header" });
    checks.push({ id: "csp", label: "Content Security Policy", status: csp ? "pass" : "warn", detail: csp ? "Present" : "Missing: helps block injected scripts" });
    checks.push({ id: "frame", label: "Clickjacking protection", status: /frame-ancestors/i.test(csp) || /deny|sameorigin/i.test(h("x-frame-options")) ? "pass" : "warn", detail: h("x-frame-options") || (/frame-ancestors/i.test(csp) ? "frame-ancestors in CSP" : "Missing X-Frame-Options or frame-ancestors") });
    checks.push({ id: "nosniff", label: "X-Content-Type-Options", status: /nosniff/i.test(h("x-content-type-options")) ? "pass" : "warn", detail: h("x-content-type-options") || "Missing nosniff" });
  } catch { checks.push({ id: "http", label: "Website", status: "fail", detail: "No answer over HTTPS in 7 s" }); }
  return { domain: d, checks };
}

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
