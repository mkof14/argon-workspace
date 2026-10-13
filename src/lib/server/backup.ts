import { gzipSync, gunzipSync } from "node:zlib";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

/**
 * Backups.
 * Data: every business table as JSON (records, comments, activity, FAQ, access rules, approvals without their link tokens,
 * profiles). Secrets are never included: calendar tokens, approval tokens, AI cache, document index (rebuilt from files).
 * Format of an encrypted file (.agronbackup), the same in the browser and on the server:
 *   "AGRONBK1" (8 bytes) | salt (16) | iv (12) | AES-256-GCM ciphertext with the 16-byte tag at the end;
 *   key = PBKDF2-SHA256(password, salt, 250 000 iterations). The plaintext is gzip-compressed JSON or a zip file.
 */
export const BUCKET = "backups";
export const MAGIC = "AGRONBK1";
export const ITER = 250_000;
const PAGE = 1000;

async function all(db: any, table: string, cols = "*", filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(cols).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Collects the data. `controlled` = include records marked US persons only (only for a US-person owner or the server). */
export async function collectData(db: any, opts: { controlled: boolean }) {
  const records = await all(db, "records", "*", (q) => (opts.controlled ? q : q.eq("controlled", false)));
  const ids = new Set(records.map((r) => r.id));
  const [comments, activity, faq, rules, approvals, profiles] = await Promise.all([
    all(db, "comments"), all(db, "activity").catch(() => []), all(db, "faq").catch(() => []), all(db, "section_access"),
    all(db, "approvals", "id,record_id,section,requested_by,approver_id,note,status,comment,created_at,decided_at,expires_at").catch(() => []),
    all(db, "profiles", "id,email,full_name,role,company,us_person,lang,title,phone,created_at").catch(() => all(db, "profiles", "id,email,full_name,role,company,us_person,lang,created_at")),
  ]);
  return {
    format: "agron-workspace-backup", version: 2, created_at: new Date().toISOString(), controlled_included: opts.controlled,
    counts: { records: records.length, comments: comments.length, activity: activity.length, faq: faq.length, profiles: profiles.length },
    records, comments: comments.filter((c: any) => ids.has(c.record_id)), activity: activity.filter((a: any) => !a.record_id || ids.has(a.record_id)),
    faq, section_access: rules, approvals: approvals.filter((a: any) => ids.has(a.record_id)), profiles,
  };
}

/** Every stored file (path and size), walking section → record → file. */
export async function listFiles(db: any): Promise<{ path: string; size: number }[]> {
  const st = db.storage.from("files"); const out: { path: string; size: number }[] = [];
  const ls = async (prefix: string) => { const { data } = await st.list(prefix, { limit: 1000 }); return data || []; };
  for (const a of await ls("")) {
    if (a.id || a.name === "_intake") continue; // top level holds only folders (sections)
    for (const b of await ls(a.name)) {
      if (b.id) { out.push({ path: `${a.name}/${b.name}`, size: b.metadata?.size || 0 }); continue; }
      for (const c of await ls(`${a.name}/${b.name}`)) if (c.id) out.push({ path: `${a.name}/${b.name}/${c.name}`, size: c.metadata?.size || 0 });
    }
  }
  return out;
}

export function encrypt(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, ITER, 32, "sha256");
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return Buffer.concat([Buffer.from(MAGIC), salt, iv, body]);
}
export function decrypt(file: Buffer, password: string): Buffer {
  if (file.subarray(0, 8).toString() !== MAGIC) throw new Error("Not an AGRON backup file");
  const salt = file.subarray(8, 24), iv = file.subarray(24, 36), body = file.subarray(36);
  const key = pbkdf2Sync(password, salt, ITER, 32, "sha256");
  const d = createDecipheriv("aes-256-gcm", key, iv); d.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
}
export const pack = (data: unknown) => gzipSync(Buffer.from(JSON.stringify(data)));
export const unpack = (gz: Buffer) => JSON.parse(gunzipSync(gz).toString("utf8"));

async function ensureBucket(db: any) {
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) await db.storage.createBucket(BUCKET, { public: false });
}

/** Weekly automatic backup: data only (files stay in storage and go into the local copy). Keeps the last 8. */
export async function runBackup(db: any) {
  await ensureBucket(db);
  const data = await collectData(db, { controlled: true });
  const gz = pack(data);
  const pass = process.env.BACKUP_PASSPHRASE || "";
  const day = new Date().toISOString().slice(0, 10);
  const name = pass ? `auto/AGRON_Workspace_${day}.agronbackup` : `auto/AGRON_Workspace_${day}.json.gz`;
  const body = pass ? encrypt(gz, pass) : gz;
  const { error } = await db.storage.from(BUCKET).upload(name, body, { contentType: "application/octet-stream", upsert: true });
  if (error) throw new Error(error.message);
  const list = (await db.storage.from(BUCKET).list("auto", { limit: 100, sortBy: { column: "name", order: "desc" } })).data || [];
  const old = list.filter((f: any) => f.id).slice(8).map((f: any) => `auto/${f.name}`);
  if (old.length) await db.storage.from(BUCKET).remove(old);
  return { name, bytes: body.length, encrypted: !!pass, counts: data.counts, body };
}

export async function listBackups(db: any) {
  const { data } = await db.storage.from(BUCKET).list("auto", { limit: 100, sortBy: { column: "name", order: "desc" } });
  return (data || []).filter((f: any) => f.id).map((f: any) => ({ name: `auto/${f.name}`, bytes: f.metadata?.size || 0, created_at: f.created_at }));
}

/** Small state notes (last monitoring run, last report) kept next to the backups. */
export async function saveState(db: any, key: string, value: unknown) { await ensureBucket(db); await db.storage.from(BUCKET).upload(`state/${key}.json`, Buffer.from(JSON.stringify(value)), { contentType: "application/json", upsert: true }); }
export async function readState(db: any, key: string) { const { data } = await db.storage.from(BUCKET).download(`state/${key}.json`); return data ? JSON.parse(await data.text()) : null; }
