// P9-R1 R9/R11 — one encrypted backup now, with the application's own backup code (the same as the daily job).
//   SOURCE_SUPABASE_URL=… SOURCE_SERVICE_ROLE_KEY=… BACKUP_PASSPHRASE=… BACKUP_S3_ENDPOINT=… BACKUP_S3_BUCKET=… \
//   BACKUP_S3_REGION=… BACKUP_S3_KEY_ID=… BACKUP_S3_SECRET=… node --experimental-strip-types --import ./scripts/guide/reg.mjs scripts/p9/backup-now.mjs
//   … scripts/p9/backup-now.mjs --stack      (the local isolated stack and its S3 sink)
// Prints the backup name, size, counts and the verification result. Nothing secret is printed.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runBackup, s3Store } from "../../src/lib/server/backup.ts";
import { s3Config } from "../../src/lib/server/s3.ts";
import { row, emit } from "../acceptance/evidence.mjs";

if (process.argv.includes("--stack")) { const e = JSON.parse(fs.readFileSync(".stack/env.json", "utf8")); for (const [k, v] of Object.entries(e)) process.env[k] ??= String(v); process.env.SOURCE_SUPABASE_URL ??= e.NEXT_PUBLIC_SUPABASE_URL; process.env.SOURCE_SERVICE_ROLE_KEY ??= e.SUPABASE_SERVICE_ROLE_KEY; }
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
const db = createClient(need("SOURCE_SUPABASE_URL"), need("SOURCE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
need("BACKUP_PASSPHRASE"); const cfg = s3Config(); if (!cfg) { console.error("Missing BACKUP_S3_* (off-project store)"); process.exit(2); }
const t0 = Date.now(); const r = await runBackup(db, { store: s3Store(cfg), deadline: Date.now() + 10 * 60e3 });
console.log(JSON.stringify({ name: r.name, bytes: r.bytes, tables: Object.keys(r.counts || {}).length, records: r.counts?.records, files: r.files, verified: r.verified, offsite: r.offsite, ms: Date.now() - t0 }));
// acceptance evidence (P9-R2): the artifact this run produced. BACKUP_ENV names the source environment (staging or
// production); the local stack is "local" and never certifies a hosted backup.
const env = process.argv.includes("--stack") ? "local" : process.env.BACKUP_ENV || "staging";
const ok = r.verified === true && r.name && r.bytes > 0 && (env !== "production" || r.offsite === true);
const ev = await row(env === "production" ? "P9.BACKUP.PRODUCTION" : "P9.BACKUP.STAGING", env, { status: ok ? "PASS" : "FAIL", source: "scripts/p9/backup-now.mjs", source_ref: r.name || `backup ${new Date().toISOString()}`, started_at: new Date(t0).toISOString(),
  summary: `${r.name}: ${r.bytes} bytes, ${r.verified ? "integrity verified" : "NOT verified"}, ${r.offsite ? "off-project" : "inside the project"}`, blocker: ok ? null : "artifact not verified or not off-project",
  metrics: { artifact: r.name, bytes: r.bytes, integrity_verified: r.verified === true, offsite: r.offsite === true, tables: Object.keys(r.counts || {}).length, files: r.files, ms: Date.now() - t0 } }, db);
console.error(`evidence: ${await emit(ev, { db })}`);
