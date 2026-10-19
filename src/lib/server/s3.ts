import { createHash, createHmac } from "node:crypto";

/**
 * A small S3-compatible client (AWS Signature Version 4, path-style URLs) for off-site backups.
 * Works with any S3-compatible store: Cloudflare R2, Backblaze B2, AWS S3, or the S3 endpoint of a second Supabase project.
 * Configured by the owner in Vercel: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET.
 * No dependency: node:crypto and fetch only.
 */
export type S3Cfg = { endpoint: string; bucket: string; region: string; keyId: string; secret: string };
export function s3Config(env: Record<string, string | undefined> = process.env): S3Cfg | null {
  const c = { endpoint: (env.BACKUP_S3_ENDPOINT || "").replace(/\/$/, ""), bucket: env.BACKUP_S3_BUCKET || "", region: env.BACKUP_S3_REGION || "auto", keyId: env.BACKUP_S3_KEY_ID || "", secret: env.BACKUP_S3_SECRET || "" };
  return c.endpoint && c.bucket && c.keyId && c.secret ? c : null;
}

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const hmac = (k: string | Buffer, s: string) => createHmac("sha256", k).update(s).digest();
/** RFC 3986 encoding as S3 expects it. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export const encodeKey = (key: string) => key.split("/").map(enc).join("/");

/** Signs a request. `headers` are the headers to sign besides host / x-amz-date / x-amz-content-sha256 (lower-case names). */
export function signV4(o: { method: string; url: URL; region: string; keyId: string; secret: string; payloadHash: string; headers?: Record<string, string>; now?: Date; service?: string }) {
  const amz = (o.now || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, ""); const dayStr = amz.slice(0, 8); const service = o.service || "s3";
  const h: Record<string, string> = { ...(o.headers || {}), host: o.url.host, "x-amz-content-sha256": o.payloadHash, "x-amz-date": amz };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const query = [...o.url.searchParams.entries()].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const creq = [o.method, o.url.pathname, query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), o.payloadHash].join("\n");
  const scope = `${dayStr}/${o.region}/${service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha(creq)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + o.secret, dayStr), o.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(sts).digest("hex");
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${o.keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`, signature };
}

async function call(c: S3Cfg, method: string, key: string, body?: Buffer, query?: Record<string, string>) {
  const url = new URL(`${c.endpoint}/${c.bucket}${key ? "/" + encodeKey(key) : ""}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const payload = body || Buffer.alloc(0);
  const { signature, ...headers } = signV4({ method, url, region: c.region, keyId: c.keyId, secret: c.secret, payloadHash: sha(payload) });
  const r = await fetch(url, { method, headers: headers as any, body: method === "PUT" ? new Uint8Array(payload) : undefined, cache: "no-store", signal: AbortSignal.timeout(30000) });
  return r;
}
export async function s3Put(c: S3Cfg, key: string, body: Buffer) { const r = await call(c, "PUT", key, body); if (!r.ok) throw new Error(`Off-site store refused the upload (${r.status}): ${(await r.text()).slice(0, 200)}`); return r.headers.get("etag"); }
export async function s3Get(c: S3Cfg, key: string): Promise<Buffer | null> { const r = await call(c, "GET", key); if (r.status === 404) return null; if (!r.ok) throw new Error(`Off-site store read failed (${r.status})`); return Buffer.from(await r.arrayBuffer()); }
export async function s3Delete(c: S3Cfg, key: string) { const r = await call(c, "DELETE", key); if (!r.ok && r.status !== 404) throw new Error(`Off-site delete failed (${r.status})`); }
export async function s3List(c: S3Cfg, prefix: string): Promise<{ key: string; size: number; modified: string }[]> {
  const out: { key: string; size: number; modified: string }[] = []; let token = "";
  for (let i = 0; i < 50; i++) {
    const q: Record<string, string> = { "list-type": "2", prefix }; if (token) q["continuation-token"] = token;
    const r = await call(c, "GET", "", undefined, q); if (!r.ok) throw new Error(`Off-site list failed (${r.status})`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const g = (t: string) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(m[1]) || [])[1] || "";
      out.push({ key: g("Key").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), size: Number(g("Size")), modified: g("LastModified") });
    }
    token = (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml) || [])[1] || "";
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !token) break;
  }
  return out;
}

/** A link that lets the owner download one object for a few minutes (query-string signature, nothing to install). */
export function presignGet(c: S3Cfg, key: string, seconds = 600, now = new Date()) {
  const url = new URL(`${c.endpoint}/${c.bucket}/${encodeKey(key)}`);
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); const dayStr = amz.slice(0, 8); const scope = `${dayStr}/${c.region}/s3/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256"); url.searchParams.set("X-Amz-Credential", `${c.keyId}/${scope}`); url.searchParams.set("X-Amz-Date", amz);
  url.searchParams.set("X-Amz-Expires", String(seconds)); url.searchParams.set("X-Amz-SignedHeaders", "host");
  const query = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const creq = ["GET", url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha(creq)].join("\n");
  const k = hmac(hmac(hmac(hmac("AWS4" + c.secret, dayStr), c.region), "s3"), "aws4_request");
  url.searchParams.set("X-Amz-Signature", createHmac("sha256", k).update(sts).digest("hex"));
  return url.toString();
}
