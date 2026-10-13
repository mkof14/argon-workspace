import { resolveTxt, resolveMx } from "node:dns/promises";
import { connect } from "node:tls";
import { publicUrl } from "./safefetch";

export type Check = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string };
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

export async function scan(domain: string): Promise<{ domain: string; checks: Check[] }> {
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

