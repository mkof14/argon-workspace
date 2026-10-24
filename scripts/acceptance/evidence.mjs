// Evidence rows produced by the tools (P9-R2). Every row carries the release identity (environment, app version,
// Git SHA, uncommitted changes, database version, migration set) and goes to a file; with RECORD=1 (or --record) it
// is also recorded in the target's append-only evidence store. Nothing secret is written: metrics are scrubbed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { identity } from "./identity.mjs";

const SECRET_KEY = /(secret|password|passphrase|token|api[_-]?key|service[_-]?role|private[_-]?key|connection[_-]?string|db[_-]?url|smtp[_-]?pass)/i;
const SECRET_VALUE = /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+|postgres(ql)?:\/\/[^\s"']+)/;
export const scrub = (x) => x == null ? x : typeof x === "string" ? (SECRET_VALUE.test(x) ? "[removed]" : x) : Array.isArray(x) ? x.map(scrub)
  : typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, SECRET_KEY.test(k) && typeof v === "string" ? "[removed]" : scrub(v)])) : x;

export const runId = (kind, sha) => `${kind}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${String(sha || "nosha").slice(0, 7)}-${crypto.randomBytes(2).toString("hex")}`;

/** A row for check `check_id`; `dbVersion` is read from the target when a client is given. */
export async function row(check_id, environment, o, db) {
  const id = identity(environment);
  let dbv = o.db_version ?? null;
  if (dbv == null && db) { try { const { data } = await db.rpc("workspace_db_version"); dbv = typeof data === "number" ? data : null; } catch {} }
  const metrics = scrub({ ...(o.metrics || {}), dirty: id.dirty });
  return { check_id, status: o.status, environment, app_version: id.app_version, git_sha: id.git_sha, db_version: dbv ?? id.db_version, migration_hash: id.migration_hash,
    started_at: o.started_at || null, completed_at: o.completed_at || new Date().toISOString(), source: o.source, source_ref: o.source_ref, summary: o.summary || null, blocker: o.blocker || null, metrics };
}

/** Write the row to dir/evidence-<check>-<ref>.json; record it too when asked. Returns the file path. */
export async function emit(r, { dir, db, record = process.env.RECORD === "1" || process.argv.includes("--record") } = {}) {
  const d = path.resolve(dir || ".staging/evidence"); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const f = path.join(d, `evidence-${r.check_id}-${String(r.source_ref).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)}.json`);
  fs.writeFileSync(f, JSON.stringify(r, null, 1));
  if (record && db) { const { data, error } = await db.rpc("acceptance_record", { p: r }); if (error) throw new Error(`recording ${r.check_id}: ${error.message}`); console.log(`recorded ${r.check_id} ${r.status} → ${data}`); }
  return f;
}
