// Disaster recovery: rebuild AGRON Workspace from an encrypted backup into an EMPTY Supabase project that already has
// the schema applied (supabase/schema.sql … update-v18.sql, in the order of scripts/stack/stack.mjs migrations()).
// Restores sign-in accounts (users set a new password via "Forgot password"), profiles, records with versions,
// comments, history, approvals, access rules, FAQ and every attached file. The same code runs in the restore drill
// (tests/integration/backup.test.ts).
//
//   TARGET_SUPABASE_URL=… TARGET_SERVICE_ROLE_KEY=… BACKUP_PASSPHRASE=… \
//   BACKUP_S3_ENDPOINT=… BACKUP_S3_BUCKET=… BACKUP_S3_REGION=… BACKUP_S3_KEY_ID=… BACKUP_S3_SECRET=… \
//   node --experimental-strip-types --import ./scripts/guide/reg.mjs scripts/restore.mjs [db/<name>.agronbackup | ./local-file] [--force]
//
// Without a name it takes the newest verified backup. It refuses to write into a project that already holds records
// unless --force is given. Secrets come only from the environment; nothing is printed except counts.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { restoreInto, s3Store, listManifests, decrypt, unpack } from "../src/lib/server/backup.ts";
import { s3Config } from "../src/lib/server/s3.ts";

const args = process.argv.slice(2), force = args.includes("--force"), name = args.find((a) => !a.startsWith("--"));
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
const url = need("TARGET_SUPABASE_URL"), key = need("TARGET_SERVICE_ROLE_KEY"), pass = need("BACKUP_PASSPHRASE");
const target = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const cfg = s3Config(); const store = cfg ? s3Store(cfg) : null;

const { count, error } = await target.from("records").select("id", { count: "exact", head: true });
if (error) { console.error("Target not ready (schema applied?):", error.message); process.exit(2); }
if (count && !force) { console.error(`Target already holds ${count} records — restore goes into an empty project. Use --force only if you are sure.`); process.exit(3); }

let file;
if (name && fs.existsSync(name)) file = fs.readFileSync(name);
else {
  if (!store) { console.error("No off-site store configured (BACKUP_S3_*) and no local file given"); process.exit(2); }
  const ms = (await listManifests(store)).filter((m) => m.verified);
  const m = name ? ms.find((x) => x.name === name) : ms[0];
  if (!m) { console.error(name ? `Backup ${name} not found or not verified` : "No verified backup found"); process.exit(2); }
  console.error(`Backup: ${m.name} (${m.created_at})`); file = await store.get(m.name);
}
const t0 = Date.now();
const res = await restoreInto(target, file, pass, store, { onStep: (s) => console.error(`… ${s}`), force });
console.error(`Restored in ${Math.round((Date.now() - t0) / 1000)} s`); console.log(JSON.stringify(res));

// Verification (P9-R1 R11): every table's row count in the target equals the backup, every file is back with its size.
// Groups named in the drill checklist: people and permissions, records, document metadata, workflows, approvals and
// policies, CRM, management, manufacturing, audit trails.
const t1 = Date.now(); const data = unpack(decrypt(file, pass)); const problems = []; const groups = {};
const group = (t) => t === "profiles" || t === "section_access" || t === "departments" ? "people and permissions" : t === "records" || t === "records_trash" || t === "comments" ? "records"
  : t.startsWith("document_") || t === "doc_pages" || t === "doc_counters" || t === "doc_number_formats" || t === "taxonomy" ? "documents" : t.startsWith("wf_") ? "workflows"
  : t.startsWith("approval") ? "approvals and policies" : t.startsWith("crm_") ? "CRM" : t.startsWith("management_") || t === "action_audit" ? "management" : t.startsWith("mfg_") ? "manufacturing"
  : t === "activity" || t.endsWith("_audit") || t.endsWith("_history") || t === "wf_events" ? "audit" : "other";
const tables = data.tables ? Object.keys(data.tables) : ["records", "comments", "activity", "approvals", "faq", "section_access", "profiles"];
for (const t of tables) {
  const want = (data.tables ? data.tables[t] : data[t] || []).length;
  const { count, error } = await target.from(t).select("*", { count: "exact", head: true });
  const ok = !error && count === want; const g = group(t); (groups[g] ||= { tables: 0, rows: 0, ok: true }).tables++; groups[g].rows += want; if (!ok) { groups[g].ok = false; problems.push(`${t}: backup ${want}, target ${error ? error.message : count}`); }
}
let filesOk = 0;
for (const f of data.files || []) {
  const dir = f.path.split("/").slice(0, -1).join("/"), name = f.path.split("/").pop();
  const { data: l } = await target.storage.from("files").list(dir, { search: name, limit: 5 });
  const hit = (l || []).find((x) => x.name === name); if (hit && (hit.metadata?.size ?? f.size) === f.size) filesOk++; else problems.push(`file ${f.path} missing or a different size`);
}
console.error(`Verified in ${Math.round((Date.now() - t1) / 1000)} s: ${tables.length} tables, ${filesOk}/${(data.files || []).length} files${problems.length ? `, ${problems.length} PROBLEM(S)` : ", all equal"}`);
console.log(JSON.stringify({ verified: problems.length === 0, groups, files: { ok: filesOk, total: (data.files || []).length }, problems: problems.slice(0, 50) }));
if (problems.length) process.exit(4);
