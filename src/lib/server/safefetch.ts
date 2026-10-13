import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Private, loopback, link-local and metadata addresses are never fetched from the server. */
export function privateIp(ip: string) {
  if (isIP(ip) === 6) { const x = ip.toLowerCase(); return x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:") && privateIp(x.slice(7)) || x === "::"; }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Checks that a URL is public https before the server touches it. Returns the reason when it is not. */
export async function publicUrl(raw: string): Promise<string | null> {
  let u: URL; try { u = new URL(raw); } catch { return "Not a valid link"; }
  if (u.protocol !== "https:") return "Only https links are checked";
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(u.hostname)) return "Private address";
  if (isIP(u.hostname)) return privateIp(u.hostname) ? "Private address" : null;
  try { const all = await lookup(u.hostname, { all: true }); if (!all.length || all.some((a) => privateIp(a.address))) return "Private address"; } catch { return "Address not found"; }
  return null;
}

/** One request with a time limit; follows redirects only to public https addresses. */
export async function timedGet(url: string, ms = 7000): Promise<{ ok: boolean; status: number; ms: number; error?: string }> {
  const t0 = Date.now(); let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    const bad = await publicUrl(cur); if (bad) return { ok: false, status: 0, ms: Date.now() - t0, error: bad };
    const ctl = new AbortController(); const id = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(cur, { method: "GET", redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "AGRON-Workspace-Monitor/1.0" }, cache: "no-store" });
      clearTimeout(id);
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location")!, cur).toString(); continue; }
      return { ok: r.status < 400, status: r.status, ms: Date.now() - t0 };
    } catch (e: any) { clearTimeout(id); return { ok: false, status: 0, ms: Date.now() - t0, error: e?.name === "AbortError" ? "No answer in 7 s" : "Cannot connect" }; }
  }
  return { ok: false, status: 0, ms: Date.now() - t0, error: "Too many redirects" };
}
