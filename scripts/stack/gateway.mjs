// Test-stack gateway: one URL like a Supabase project (/auth/v1, /rest/v1, /storage/v1), an S3-compatible
// bucket for off-site backup tests (/s3, AWS Signature V4 checked), and an SMTP sink that keeps every e-mail as JSON.
// Storage requests run as the caller's database role with the caller's JWT claims, so the real storage policies apply.
// node gateway.mjs   (env: STACK_DIR, PG_URL, JWT_SECRET, S3_KEY_ID, S3_SECRET, ports)
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const STACK = process.env.STACK_DIR; const require = createRequire(path.join(STACK, "nm", "package.json"));
const { Pool } = require("pg");
const PORT = +(process.env.GATEWAY_PORT || 54321), AUTH = process.env.AUTH_URL || "http://127.0.0.1:9999", REST = process.env.REST_URL || "http://127.0.0.1:54330";
const SECRET = process.env.JWT_SECRET; const S3_ID = process.env.S3_KEY_ID, S3_SECRET = process.env.S3_SECRET;
const pool = new Pool({ connectionString: process.env.PG_URL, max: 10 });
const FILES = path.join(STACK, "storage"), S3DIR = path.join(STACK, "s3"), MAIL = path.join(STACK, "mail");
for (const d of [FILES, S3DIR, MAIL]) fs.mkdirSync(d, { recursive: true });

function verify(token) {
  const [h, p, s] = String(token || "").split("."); if (!s) return null;
  const sig = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(s))) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString()); if (c.exp && c.exp * 1000 < Date.now()) return null; return c;
}
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD", "access-control-expose-headers": "*" };
const send = (res, code, body, headers = {}) => { const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)); res.writeHead(code, { ...cors, "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json", ...headers }); res.end(b); };
const readBody = (req) => new Promise((ok, no) => { const ch = []; req.on("data", (c) => ch.push(c)); req.on("end", () => ok(Buffer.concat(ch))); req.on("error", no); });

function proxy(req, res, target, strip) {
  const u = new URL(target); const headers = { ...req.headers, host: u.host };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const p = http.request({ hostname: u.hostname, port: u.port, method: req.method, path: req.url.slice(strip.length) || "/", headers }, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res); });
  p.on("error", (e) => send(res, 502, { message: String(e) })); req.pipe(p);
}

/* ---------------- Storage ---------------- */
async function asCaller(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const role = claims?.role === "service_role" ? "service_role" : claims?.role === "authenticated" ? "authenticated" : "anon";
    await c.query(`set local role ${role}`); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: "anon" })]);
    const out = await fn(c); await c.query("commit"); return out;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const fileOf = (bucket, name) => path.join(FILES, bucket, ...name.split("/"));
function multipart(buf, ct) {
  const m = /boundary=([^;]+)/.exec(ct || ""); if (!m) return null; const bnd = Buffer.from("--" + m[1].replace(/"/g, ""));
  let i = buf.indexOf(bnd); const parts = [];
  while (i >= 0) { const j = buf.indexOf(bnd, i + bnd.length); if (j < 0) break; const part = buf.subarray(i + bnd.length + 2, j - 2); const k = part.indexOf("\r\n\r\n"); parts.push({ head: part.subarray(0, k).toString(), body: part.subarray(k + 4) }); i = j; }
  const f = parts.find((p) => /filename=/.test(p.head)) || parts.find((p) => !/name="cacheControl"/.test(p.head));
  return f ? { body: f.body, type: (/content-type:\s*([^\r\n]+)/i.exec(f.head) || [])[1] } : null;
}
const signedTokens = new Map();
async function storage(req, res, rest) {
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, ""); const claims = verify(auth) || verify(req.headers.apikey);
  const url = new URL(rest, "http://x"); const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === "bucket") {
      if (req.method === "GET" && parts[1]) { const r = await asCaller({ role: "service_role" }, (c) => c.query("select * from storage.buckets where id=$1", [parts[1]])); return r.rows[0] ? send(res, 200, r.rows[0]) : send(res, 400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" }); }
      if (req.method === "POST") { if (claims?.role !== "service_role") return send(res, 403, { message: "Unauthorized" }); const b = JSON.parse((await readBody(req)).toString() || "{}"); await asCaller(claims, (c) => c.query("insert into storage.buckets(id,name,public) values($1,$1,$2) on conflict do nothing", [b.id || b.name, !!b.public])); return send(res, 200, { name: b.id || b.name }); }
    }
    if (parts[0] !== "object") return send(res, 404, { message: "not found" });
    let [, a, b, ...more] = parts;
    if (a === "list" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}"); const prefix = String(body.prefix || "").replace(/\/$/, ""); const pre = prefix ? prefix + "/" : "";
      const r = await asCaller(claims, (c) => c.query("select id,name,metadata,created_at,updated_at,last_accessed_at from storage.objects where bucket_id=$1 and name like $2", [b, pre.replace(/[%_]/g, (x) => "\\" + x) + "%"]));
      const out = new Map();
      for (const o of r.rows) { const restName = o.name.slice(pre.length); const k = restName.indexOf("/"); if (k < 0) out.set(restName, { name: restName, id: o.id, updated_at: o.updated_at, created_at: o.created_at, last_accessed_at: o.last_accessed_at, metadata: o.metadata }); else { const f = restName.slice(0, k); if (!out.has(f)) out.set(f, { name: f, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null }); } }
      const col = body.sortBy?.column || "name", desc = body.sortBy?.order === "desc";
      const arr = [...out.values()].sort((x, y) => String(x[col] ?? x.name).localeCompare(String(y[col] ?? y.name)) * (desc ? -1 : 1));
      return send(res, 200, arr.slice(body.offset || 0, (body.offset || 0) + (body.limit || 100)));
    }
    if (a === "sign" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const one = async (bucket, name) => { const r = await asCaller(claims, (c) => c.query("select 1 from storage.objects where bucket_id=$1 and name=$2", [bucket, name])); if (!r.rowCount) return null; const t = crypto.randomBytes(16).toString("hex"); signedTokens.set(t, { bucket, name, exp: Date.now() + (body.expiresIn || 60) * 1000 }); return `/object/sign/${bucket}/${name}?token=${t}`; };
      if (body.paths) { const list = []; for (const p of body.paths) { const s = await one(b, p); list.push({ path: p, signedURL: s, error: s ? null : "Either the object does not exist or you do not have access to it" }); } return send(res, 200, list); }
      const s = await one(b, more.join("/")); return s ? send(res, 200, { signedURL: s }) : send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    }
    if (a === "sign" && req.method === "GET") {
      const t = signedTokens.get(url.searchParams.get("token") || ""); const name = more.join("/");
      if (!t || t.exp < Date.now() || t.bucket !== b || t.name !== name) return send(res, 400, { message: "invalid signature" });
      return send(res, 200, fs.readFileSync(fileOf(b, name)));
    }
    if (a === "move" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const r = await asCaller(claims, (c) => c.query("update storage.objects set name=$3, updated_at=now() where bucket_id=$1 and name=$2 returning id", [body.bucketId, body.sourceKey, body.destinationKey]));
      if (!r.rowCount) return send(res, 400, { message: "Object not found" });
      const to = fileOf(body.bucketId, body.destinationKey); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(fileOf(body.bucketId, body.sourceKey), to); return send(res, 200, { message: "Successfully moved" });
    }
    if (req.method === "DELETE" && a && !b) {
      const body = JSON.parse((await readBody(req)).toString() || "{}"); const out = [];
      for (const p of body.prefixes || []) { const r = await asCaller(claims, (c) => c.query("delete from storage.objects where bucket_id=$1 and name=$2 returning name, id", [a, p])); for (const x of r.rows) { out.push({ name: x.name, id: x.id, bucket_id: a }); fs.rmSync(fileOf(a, x.name), { force: true }); } }
      return send(res, 200, out);
    }
    // upload / update / download: /object/{bucket}/{name} (also /object/authenticated|public/{bucket}/{name})
    if (a === "authenticated" || a === "public") { a = b; b = more.shift(); }
    const bucket = a, name = [b, ...more].join("/");
    if (req.method === "GET" || req.method === "HEAD") {
      const r = await asCaller(claims, (c) => c.query("select metadata from storage.objects where bucket_id=$1 and name=$2", [bucket, name]));
      if (!r.rowCount) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return send(res, 200, fs.readFileSync(fileOf(bucket, name)), { "content-type": r.rows[0].metadata?.mimetype || "application/octet-stream" });
    }
    if (req.method === "POST" || req.method === "PUT") {
      let body = await readBody(req); let type = req.headers["content-type"] || "application/octet-stream";
      if (/multipart\/form-data/.test(type)) { const m = multipart(body, type); if (m) { body = m.body; type = m.type || "application/octet-stream"; } }
      const upsert = req.method === "PUT" || req.headers["x-upsert"] === "true"; const meta = { size: body.length, mimetype: type, eTag: crypto.createHash("md5").update(body).digest("hex") };
      const r = await asCaller(claims, async (c) => {
        if (upsert) { const u = await c.query("update storage.objects set metadata=$3, updated_at=now() where bucket_id=$1 and name=$2 returning id", [bucket, name, meta]); if (u.rowCount) return u; }
        return c.query("insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4) returning id", [bucket, name, claims?.sub || null, meta]);
      });
      const f = fileOf(bucket, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
      return send(res, 200, { Id: r.rows[0].id, Key: `${bucket}/${name}` });
    }
    return send(res, 404, { message: "not found" });
  } catch (e) {
    const msg = String(e?.message || e); const code = /row-level security|permission denied/i.test(msg) ? 403 : /duplicate key/i.test(msg) ? 409 : 500;
    return send(res, code === 500 ? 500 : 400, { statusCode: String(code), error: code === 409 ? "Duplicate" : "Unauthorized", message: code === 409 ? "The resource already exists" : msg });
  }
}

/* ---------------- S3-compatible bucket (path style), Signature V4 verified ---------------- */
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function s3Verify(req, body, u) {
  const a = req.headers.authorization || ""; const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/.exec(a);
  if (!m || m[1] !== S3_ID) return false;
  const [, , day, region, signed, sig] = m; const amz = req.headers["x-amz-date"]; const ph = req.headers["x-amz-content-sha256"];
  if (ph !== "UNSIGNED-PAYLOAD" && ph !== sha(body)) return false;
  const q = [...u.searchParams.entries()].sort(([a1, b1], [a2, b2]) => (a1 === a2 ? (b1 < b2 ? -1 : 1) : a1 < a2 ? -1 : 1)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonHeaders = signed.split(";").map((h) => `${h}:${String(req.headers[h]).trim()}\n`).join("");
  const creq = [req.method, u.pathname, q, canonHeaders, signed, ph].join("\n");
  const sts = ["AWS4-HMAC-SHA256", amz, `${day}/${region}/s3/aws4_request`, sha(creq)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + S3_SECRET, day), region), "s3"), "aws4_request");
  return crypto.createHmac("sha256", key).update(sts).digest("hex") === sig;
}
async function s3(req, res, rest) {
  const body = await readBody(req); const u = new URL(rest, "http://x"); u.pathname = "/s3" + u.pathname;
  if (!s3Verify(req, body, u)) return send(res, 403, "<Error><Code>SignatureDoesNotMatch</Code></Error>", { "content-type": "application/xml" });
  const [bucket, ...k] = u.pathname.split("/").slice(2).map(decodeURIComponent); const key = k.join("/"); const dir = path.join(S3DIR, bucket); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, encodeURIComponent(key));
  if (req.method === "PUT") { fs.writeFileSync(file, body); return send(res, 200, "", { etag: `"${crypto.createHash("md5").update(body).digest("hex")}"` }); }
  if (req.method === "GET" && key) return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file)) : send(res, 404, "<Error><Code>NoSuchKey</Code></Error>", { "content-type": "application/xml" });
  if (req.method === "HEAD" && key) { if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-length": fs.statSync(file).size }); return res.end(); }
  if (req.method === "DELETE") { fs.rmSync(file, { force: true }); return send(res, 204, ""); }
  if (req.method === "GET") {
    const prefix = u.searchParams.get("prefix") || ""; const items = fs.readdirSync(dir).map(decodeURIComponent).filter((x) => x.startsWith(prefix)).sort();
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${items.length}</KeyCount><IsTruncated>false</IsTruncated>${items.map((x) => { const st = fs.statSync(path.join(dir, encodeURIComponent(x))); return `<Contents><Key>${x.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Key><Size>${st.size}</Size><LastModified>${st.mtime.toISOString()}</LastModified></Contents>`; }).join("")}</ListBucketResult>`;
    return send(res, 200, xml, { "content-type": "application/xml" });
  }
  return send(res, 405, "");
}

/* ---------------- SMTP sink ---------------- */
net.createServer((sock) => {
  let data = false, buf = "", from = "", to = []; const w = (s) => sock.write(s + "\r\n"); w("220 agron-stack ESMTP");
  sock.on("data", (d) => {
    buf += d.toString("latin1");
    while (true) {
      if (data) { const k = buf.indexOf("\r\n.\r\n"); if (k < 0) return; const raw = buf.slice(0, k); buf = buf.slice(k + 5); data = false;
        const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`; fs.writeFileSync(path.join(MAIL, `${id}.json`), JSON.stringify({ from, to, raw: Buffer.from(raw, "latin1").toString("utf8"), at: new Date().toISOString() }));
        if (to.some((a) => a.endsWith("@drop.test"))) { sock.destroy(); return; } // delivered, but the sender never hears back
        from = ""; to = []; w(`250 OK queued as ${id}`); continue; }
      const k = buf.indexOf("\r\n"); if (k < 0) return; const line = buf.slice(0, k); buf = buf.slice(k + 2); const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") { sock.write("250-agron-stack\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"); }
      else if (cmd === "HELO") w("250 agron-stack");
      else if (cmd === "AUTH") w("235 Authentication successful");
      else if (cmd === "MAIL") { from = (/<([^>]*)>/.exec(line) || [])[1] || ""; w("250 OK"); }
      else if (cmd === "RCPT") { const a = (/<([^>]*)>/.exec(line) || [])[1] || "";
        // test addresses: @fail.test refused for good, @busy.test refused for now, @drop.test: the connection breaks after the message
        if (a.endsWith("@fail.test")) { w("550 No such user"); continue; } if (a.endsWith("@busy.test")) { w("451 Try again later"); continue; } to.push(a); w("250 OK"); }
      else if (cmd === "DATA") { data = true; w("354 End data with <CR><LF>.<CR><LF>"); }
      else if (cmd === "QUIT") { w("221 Bye"); sock.end(); return; }
      else if (cmd === "RSET" || cmd === "NOOP") w("250 OK");
      else w("250 OK");
    }
  });
  sock.on("error", () => {});
}).listen(+(process.env.SMTP_PORT || 54325), "127.0.0.1");

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const u = req.url || "/";
  if (u === "/health") return send(res, 200, { ok: true });
  if (u.startsWith("/auth/v1")) return proxy(req, res, AUTH, "/auth/v1");
  if (u.startsWith("/rest/v1")) return proxy(req, res, REST, "/rest/v1");
  if (u.startsWith("/storage/v1")) return storage(req, res, u.slice("/storage/v1".length));
  if (u.startsWith("/s3/")) return s3(req, res, u.slice(3));
  send(res, 404, { message: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`gateway on ${PORT}`));
