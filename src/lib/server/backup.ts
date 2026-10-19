import { gzipSync, gunzipSync } from "node:zlib";
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { s3Config, s3Delete, s3Get, s3List, s3Put, type S3Cfg } from "./s3";
import { readState, saveState } from "./state";
import { retention } from "@/lib/retention";

/**
 * Backups (v18).
 * - Encryption is required: without BACKUP_PASSPHRASE nothing is written (the job fails and administrators are told).
 * - Where: an S3-compatible store outside the Supabase project (BACKUP_S3_*). Until that is set, copies go to the
 *   private "backups" bucket of the same project and the status screen says the copy is not off-site.
 * - What: every business table (records with versions, comments, activity, FAQ, access rules, approvals without
 *   their link tokens, profiles) plus every stored file. Files are copied once each, encrypted and named by their
 *   SHA-256, so a daily backup only adds new or changed files. Secrets are never included.
 * - Each backup is read back, decrypted and checked against its SHA-256 before it counts as done.
 * - Retention: daily for 14 days, Mondays for 8 weeks, first of each month for 12 months (lib/retention.ts).
 * Format of an encrypted object (.agronbackup), the same in the browser and on the server:
 *   "AGRONBK1" (8 bytes) | salt (16) | iv (12) | AES-256-GCM ciphertext with the 16-byte tag at the end;
 *   key = PBKDF2-SHA256(password, salt, 250 000 iterations). The plaintext is gzip-compressed JSON (or raw file bytes).
 */
export const BUCKET = "backups";
export const MAGIC = "AGRONBK1";
export const ITER = 250_000;
const PAGE = 1000;
export { readState, saveState } from "./state";
export class BackupConfigError extends Error { constructor(m: string) { super(m); this.name = "BackupConfigError"; } }
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

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
    all(db, "profiles", "id,email,full_name,role,company,us_person,lang,title,phone,timezone,prefs,disabled,created_at").catch(() => all(db, "profiles", "id,email,full_name,role,company,us_person,lang,created_at")),
  ]);
  return {
    format: "agron-workspace-backup", version: 3, created_at: new Date().toISOString(), controlled_included: opts.controlled,
    counts: { records: records.length, comments: comments.length, activity: activity.length, faq: faq.length, profiles: profiles.length, section_access: rules.length },
    records, comments: comments.filter((c: any) => ids.has(c.record_id)), activity: activity.filter((a: any) => !a.record_id || ids.has(a.record_id)),
    faq, section_access: rules, approvals: approvals.filter((a: any) => ids.has(a.record_id)), profiles,
  };
}

/** Every stored file (path, size, last change), walking section → record → file. */
export async function listFiles(db: any): Promise<{ path: string; size: number; updated: string }[]> {
  const st = db.storage.from("files"); const out: { path: string; size: number; updated: string }[] = [];
  const ls = async (prefix: string) => { const { data } = await st.list(prefix, { limit: 1000 }); return data || []; };
  for (const a of await ls("")) {
    if (a.id || a.name === "_intake") continue; // top level holds only folders (sections)
    for (const b of await ls(a.name)) {
      if (b.id) { out.push({ path: `${a.name}/${b.name}`, size: b.metadata?.size || 0, updated: b.updated_at || "" }); continue; }
      for (const c of await ls(`${a.name}/${b.name}`)) if (c.id) out.push({ path: `${a.name}/${b.name}/${c.name}`, size: c.metadata?.size || 0, updated: c.updated_at || "" });
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

/* ---------------- where copies go ---------------- */
export type Store = { kind: "s3" | "project"; offsite: boolean; put(k: string, b: Buffer): Promise<void>; get(k: string): Promise<Buffer | null>; list(prefix: string): Promise<{ key: string; size: number; modified: string }[]>; del(k: string): Promise<void> };
export function s3Store(c: S3Cfg): Store {
  return { kind: "s3", offsite: true, put: async (k, b) => { await s3Put(c, k, b); }, get: (k) => s3Get(c, k), list: (p) => s3List(c, p), del: (k) => s3Delete(c, k) };
}
async function ensureBucket(db: any) { const { data } = await db.storage.getBucket(BUCKET); if (!data) await db.storage.createBucket(BUCKET, { public: false }); }
export function projectStore(db: any): Store {
  const st = () => db.storage.from(BUCKET); const P = "v3/";
  return {
    kind: "project", offsite: false,
    put: async (k, b) => { await ensureBucket(db); const { error } = await st().upload(P + k, b, { contentType: "application/octet-stream", upsert: true }); if (error) throw new Error(error.message); },
    get: async (k) => { const { data } = await st().download(P + k); return data ? Buffer.from(await data.arrayBuffer()) : null; },
    list: async (prefix) => {
      const dir = (P + prefix).replace(/\/[^/]*$/, ""); const base = dir.slice(P.length); const out: { key: string; size: number; modified: string }[] = [];
      for (let off = 0; ; off += 1000) { const { data } = await st().list(dir, { limit: 1000, offset: off }); for (const f of data || []) if (f.id) out.push({ key: `${base ? base + "/" : ""}${f.name}`, size: f.metadata?.size || 0, modified: f.updated_at || f.created_at || "" }); if (!data || data.length < 1000) break; }
      return out.filter((f) => f.key.startsWith(prefix));
    },
    del: async (k) => { await st().remove([P + k]); },
  };
}
export const backupStore = (db: any) => { const c = s3Config(); return c ? s3Store(c) : projectStore(db); };

type FileIndex = Record<string, { sha: string; size: number; updated: string }>;
export type Manifest = { name: string; created_at: string; bytes: number; sha256_cipher: string; sha256_plain: string; counts: Record<string, number>; files: number; files_bytes: number; file_shas: string[]; verified: boolean; target: string; offsite: boolean; ms: number };
const stampOf = (iso: string) => iso.replace(/[:]/g, "").slice(0, 15); // 2026-10-19T0930

/**
 * One backup run. Files first (incremental; stops before the deadline and continues on the next run), then the
 * data, then the read-back check, the manifest and the retention clean-up.
 */
export async function runBackup(db: any, o: { deadline?: number; store?: Store; now?: Date } = {}) {
  const pass = process.env.BACKUP_PASSPHRASE || "";
  if (!pass) throw new BackupConfigError("BACKUP_PASSPHRASE is not set — Workspace never writes an unencrypted backup. Add it in Vercel → Settings → Environment Variables.");
  const t0 = Date.now(); const deadline = o.deadline ?? t0 + 50_000; const store = o.store || backupStore(db); const now = o.now || new Date();
  // 1. files: copy what is new or changed since the last run
  const index: FileIndex = (await readState(db, "backup-files")) || {};
  const files = await listFiles(db); let copied = 0, left = 0;
  const have = new Set(Object.values(index).map((x) => x.sha));
  for (const f of files) {
    const ix = index[f.path]; if (ix && ix.size === f.size && ix.updated === f.updated) continue;
    if (Date.now() > deadline - 15_000) { left++; continue; }
    const { data: blob, error } = await db.storage.from("files").download(f.path);
    if (error || !blob) throw new Error(`file ${f.path}: ${error?.message || "not readable"}`);
    const buf = Buffer.from(await blob.arrayBuffer()); const sha = sha256(buf);
    if (!have.has(sha)) { await store.put(`files/${sha}`, encrypt(buf, pass)); have.add(sha); }
    index[f.path] = { sha, size: f.size, updated: f.updated }; copied++;
    if (copied % 20 === 0) await saveState(db, "backup-files", index);
  }
  for (const p of Object.keys(index)) if (!files.some((f) => f.path === p)) delete index[p]; // deleted files leave the index (older backups still list them)
  await saveState(db, "backup-files", index);
  if (left) return { partial: true, left, copied };
  // 2. data
  const data: any = await collectData(db, { controlled: true });
  const stamp = stampOf(now.toISOString());
  const name = `db/AGRON_Workspace_${stamp}.agronbackup`;
  data.files = files.map((f) => ({ path: f.path, size: f.size, updated: f.updated, sha: index[f.path]?.sha })).filter((x) => x.sha);
  data.backup = { name, target: store.kind, offsite: store.offsite };
  const plain = pack(data); const cipher = encrypt(plain, pass);
  await store.put(name, cipher);
  // 3. read it back and prove it opens
  const back = await store.get(name); if (!back) throw new Error("The backup could not be read back");
  const opened = decrypt(back, pass); if (sha256(opened) !== sha256(plain)) throw new Error("The backup read back does not match what was written");
  const check = unpack(opened); if (check.counts?.records !== data.counts.records) throw new Error("The backup read back has different counts");
  const stored = new Set((await store.list("files/")).map((x) => x.key.slice(6)));
  const missing = data.files.filter((f: any) => !stored.has(f.sha)); if (missing.length) throw new Error(`${missing.length} file(s) are missing in the backup store`);
  // 4. manifest (no content, only what is needed to find and check the backup)
  const m: Manifest = { name, created_at: now.toISOString(), bytes: cipher.length, sha256_cipher: sha256(cipher), sha256_plain: sha256(plain), counts: data.counts, files: data.files.length, files_bytes: data.files.reduce((a: number, f: any) => a + (f.size || 0), 0), file_shas: [...new Set<string>(data.files.map((f: any) => f.sha))], verified: true, target: store.kind, offsite: store.offsite, ms: Date.now() - t0 };
  await store.put(`manifest/${stamp}.json`, Buffer.from(JSON.stringify(m)));
  // 5. retention
  const ret = await applyRetention(store, now.toISOString().slice(0, 10));
  await saveState(db, "backup", { at: m.created_at, name, bytes: m.bytes, encrypted: true, verified: true, counts: m.counts, files: m.files, files_bytes: m.files_bytes, target: store.kind, offsite: store.offsite, ms: m.ms, dropped: ret.dropped });
  return { name, bytes: m.bytes, counts: m.counts, files: m.files, copied, verified: true, offsite: store.offsite, ms: m.ms, dropped: ret.dropped, files_removed: ret.files_removed };
}

export async function listManifests(store: Store): Promise<Manifest[]> {
  const keys = (await store.list("manifest/")).map((x) => x.key).filter((k) => k.endsWith(".json")).sort().reverse();
  const out: Manifest[] = [];
  for (const k of keys.slice(0, 120)) { const b = await store.get(k); if (b) try { out.push(JSON.parse(b.toString())); } catch {} }
  return out;
}
export async function applyRetention(store: Store, today: string) {
  const ms = await listManifests(store);
  const { keep, drop } = retention(ms.map((m) => ({ name: m.name, date: m.created_at.slice(0, 10) })), today);
  for (const name of drop) { const m = ms.find((x) => x.name === name)!; await store.del(name); await store.del(`manifest/${stampOf(m.created_at)}.json`); }
  const used = new Set(ms.filter((m) => keep.includes(m.name)).flatMap((m) => m.file_shas || []));
  let removed = 0; if (ms.length) for (const f of await store.list("files/")) if (!used.has(f.key.slice(6))) { await store.del(f.key); removed++; }
  return { dropped: drop.length, files_removed: removed };
}
export async function listBackups(db: any) {
  return (await listManifests(backupStore(db))).map((m) => ({ name: m.name, bytes: m.bytes, created_at: m.created_at, verified: m.verified, files: m.files, offsite: m.offsite, counts: m.counts }));
}

/* ---------------- restore (into an empty, separate project) ---------------- */
const RESTORE_TABLES = ["section_access", "profiles", "records", "comments", "activity", "approvals", "faq"] as const;
/**
 * Restores a backup into another, empty Workspace database (disaster recovery or a restore drill).
 * Needs the target's service key. Users are created in the target's sign-in service with the same ids and e-mails
 * (they set a new password through "Forgot password"). Rows are inserted as they were (ids, versions, history),
 * never overwriting anything already there. Files are decrypted from the backup store into the target's Storage.
 */
export async function restoreInto(target: any, file: Buffer, pass: string, store: Store | null, o: { onStep?: (s: string) => void } = {}) {
  const t0 = Date.now(); const step = o.onStep || (() => {});
  const data = unpack(decrypt(file, pass)); const done: Record<string, number> = {};
  step("users");
  let users = 0;
  for (const p of data.profiles || []) {
    const { error } = await target.auth.admin.createUser({ id: p.id, email: p.email, email_confirm: true, user_metadata: { full_name: p.full_name } } as any);
    if (!error) users++; else if (!/already|exists|registered/i.test(error.message)) throw new Error(`user ${p.email}: ${error.message}`);
  }
  done.users = users;
  for (const t of RESTORE_TABLES) {
    step(t); const rows = (data as any)[t] || []; let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { data: k, error } = await target.rpc("restore_load", { p_table: t, p_rows: rows.slice(i, i + 500) });
      if (error) throw new Error(`${t}: ${error.message}`); n += Number(k) || 0;
    }
    done[t] = n;
  }
  step("files"); let files = 0, bytes = 0;
  if (store) for (const f of data.files || []) {
    const enc = await store.get(`files/${f.sha}`); if (!enc) throw new Error(`file ${f.path} is missing in the backup store`);
    const buf = decrypt(enc, pass); if (sha256(buf) !== f.sha) throw new Error(`file ${f.path} does not match its checksum`);
    const { error } = await target.storage.from("files").upload(f.path, buf, { upsert: true, contentType: "application/octet-stream" });
    if (error) throw new Error(`file ${f.path}: ${error.message}`); files++; bytes += buf.length;
  }
  done.files = files;
  return { ...done, bytes, backup_created_at: data.created_at, ms: Date.now() - t0 };
}
