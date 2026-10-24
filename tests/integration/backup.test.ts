// Backup and disaster recovery, end to end on synthetic data: an encrypted backup with files goes to an
// S3-compatible store outside the project, is read back and checked, only new files are copied the next day,
// tampering is detected, no backup is written without the passphrase — and after wiping the database, Storage and
// sign-in accounts, a restore brings back records, versions, history, comments, approvals, access rules, people and
// file bytes, with the same permissions. Recovery time and data-loss window are measured.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { admin, anon, ENV, makeUser, PASSWORD, signIn, sql, uid } from "./_stack.ts";
import { runBackup, restoreInto, s3Store, decrypt, listManifests, BackupConfigError, postRestoreVerify } from "../../src/lib/server/backup.ts";
import { s3Config } from "../../src/lib/server/s3.ts";
import { saveState } from "../../src/lib/server/state.ts";

const db = admin(); const run = uid(); const store = s3Store(s3Config()!); const pass = ENV.BACKUP_PASSPHRASE;
let eng: any, owner: any; const files: Record<string, Buffer> = {};
export const evidence: Record<string, any> = {};

before(async () => {
  owner = await makeUser(`bo-${run}@agron-stack.test`, "owner", { us: true }); eng = await makeUser(`be-${run}@agron-stack.test`, "engineering");
  const rows = [
    { section: "company.tasks", title: `Task ${run}`, status: "Open", data: { assignee: eng.email, due: "2026-12-01" } },
    { section: "technical.equipment", title: `Radar spec ${run}`, status: "Candidate", data: { manufacturer: "Synthetic" }, controlled: true },
    { section: "finance.invoices", title: `Invoice ${run}`, status: "Draft", data: { amount: 1234.5, currency: "USD" } },
  ];
  const { data, error } = await db.from("records").insert(rows.map((r: any) => ({ controlled: false, ...r, created_by: owner.id }))).select("*"); if (error) throw error;
  await db.from("records").update({ status: "In progress" }).eq("id", data![0].id); // version 2 + history
  await db.from("comments").insert({ record_id: data![0].id, author: owner.id, body: `Please start ${run}` });
  await db.from("approvals").insert({ record_id: data![2].id, section: "finance.invoices", requested_by: eng.id, approver_id: owner.id, token_hash: "x".repeat(64), note: "synthetic" });
  for (const [i, r] of data!.entries()) { const p = `${r.section}/${r.id}/1_doc${i}.bin`; const b = Buffer.from(`synthetic file ${i} ${run} `.repeat(200 * (i + 1))); files[p] = b; const u = await db.storage.from("files").upload(p, b, { contentType: "application/octet-stream" }); assert.ifError(u.error); }
});

const snapshot = async () => ({
  records: await sql("select id, section, title, status, data, company, controlled, created_by, created_at, updated_at, version from records order by id"),
  comments: await sql("select id, record_id, author, body, created_at from comments order by id"),
  activity: await sql("select id, record_id, section, actor, action, detail, created_at from activity order by id"),
  approvals: await sql("select id, record_id, section, requested_by, approver_id, note, status, created_at, expires_at from approvals order by id"),
  access: await sql("select section, role, can_write, external from section_access order by section, role"),
  profiles: await sql("select id, email, role, us_person, company, lang from profiles order by id"),
});

test("no passphrase: nothing is written, the error says why", async () => {
  const before = (await store.list("db/")).length; const keep = process.env.BACKUP_PASSPHRASE; delete process.env.BACKUP_PASSPHRASE;
  try { await assert.rejects(runBackup(db, { store }), BackupConfigError); } finally { process.env.BACKUP_PASSPHRASE = keep; }
  assert.equal((await store.list("db/")).length, before);
});

test("backup, restore drill and measured recovery", async () => {
  // 1. backup to the off-site store
  const t0 = Date.now(); const b1: any = await runBackup(db, { store }); const backupMs = Date.now() - t0;
  assert.equal(b1.verified, true); assert.equal(b1.offsite, true); assert.ok(b1.files >= 3); assert.ok(b1.copied >= 3);
  const m = (await listManifests(store)).find((x) => x.name === b1.name)!; assert.ok(m, "manifest written"); assert.equal(m.verified, true); assert.ok(m.sha256_cipher.length === 64);
  const raw = fs.readdirSync(path.join(ENV.STACK_DIR, "s3", "agron-backups")).map(decodeURIComponent);
  assert.ok(raw.some((k) => k.startsWith("db/")) && raw.filter((k) => k.startsWith("files/")).length >= 3);
  const onDisk = fs.readFileSync(path.join(ENV.STACK_DIR, "s3", "agron-backups", encodeURIComponent(b1.name)));
  assert.equal(onDisk.subarray(0, 8).toString(), "AGRONBK1"); assert.ok(!onDisk.includes(Buffer.from(`Radar spec ${run}`)), "nothing readable without the passphrase");
  // 2. the next day only what changed is copied
  const b2: any = await runBackup(db, { store, now: new Date(Date.now() + 864e5) }); assert.equal(b2.copied, 0);
  const changed = Object.keys(files)[0]; files[changed] = Buffer.from(`changed ${run}`); await db.storage.from("files").upload(changed, files[changed], { upsert: true });
  const b3: any = await runBackup(db, { store, now: new Date(Date.now() + 2 * 864e5) }); assert.equal(b3.copied, 1);
  // 3. tampering is detected
  const enc = await store.get(b3.name); const bad = Buffer.from(enc!); bad[bad.length - 40] ^= 0xff; assert.throws(() => decrypt(bad, pass), "a changed byte breaks the authentication tag");
  assert.throws(() => decrypt(enc!, "wrong passphrase"));
  // 4. the disaster: database, files and sign-in accounts are gone
  const b4: any = await runBackup(db, { store }); // tonight's copy, made at the real time
  const before = await snapshot(); const tBackup = Date.parse((await listManifests(store)).find((x) => x.name === b4.name)!.created_at);
  await sql("truncate public.records, public.comments, public.activity, public.approvals, public.faq, public.section_access, public.records_trash cascade");
  await sql("delete from storage.objects where bucket_id = 'files'"); fs.rmSync(path.join(ENV.STACK_DIR, "storage", "files"), { recursive: true, force: true });
  await sql("delete from auth.users");
  assert.equal((await sql("select count(*)::int n from records"))[0].n, 0); assert.equal((await sql("select count(*)::int n from profiles"))[0].n, 0);
  const tDisaster = Date.now();
  // 5. restore from the newest backup
  const t1 = Date.now(); const newest = (await listManifests(store)).find((x) => x.name === b4.name)!; const file = await store.get(newest.name);
  const res = await restoreInto(db, file!, pass, store); const restoreMs = Date.now() - t1;
  const after = await snapshot();
  for (const k of Object.keys(before) as (keyof typeof before)[]) assert.deepEqual(after[k], before[k], `${k} restored exactly`);
  for (const [p, b] of Object.entries(files)) { const d = await db.storage.from("files").download(p); assert.ifError(d.error); assert.ok(Buffer.from(await d.data!.arrayBuffer()).equals(b), `${p} bytes`); }
  // 6. permissions work as before: the engineer signs in (new password after recovery) and still cannot see US-persons-only data
  await db.auth.admin.updateUserById(eng.id, { password: PASSWORD });
  const { c } = await signIn(eng.email);
  const seen = ((await c.from("records").select("id,controlled").ilike("title", `%${run}%`)).data || []);
  assert.ok(seen.length >= 1 && seen.every((r: any) => !r.controlled));
  const ctl = before.records.find((r: any) => r.controlled && r.title.includes(run));
  assert.ok((await c.storage.from("files").download(Object.keys(files).find((p) => p.includes(ctl.id))!)).error, "file of a US-persons-only record stays closed");
  assert.equal((await sql("select max(id) m from activity"))[0].m, before.activity.at(-1)?.id, "history ids kept");
  const nx = await db.from("records").insert({ section: "company.tasks", title: `after restore ${run}`, data: {} }).select("id").single(); assert.ifError(nx.error);
  Object.assign(evidence, { backup_ms: backupMs, restore_ms: restoreMs, rpo_seconds_in_drill: Math.round((tDisaster - tBackup) / 1000), rpo_policy_hours: 24, restored: res, records: before.records.length, files: Object.keys(files).length, bytes: res.bytes });
  await saveState(db, "restore-drill", { at: new Date().toISOString(), ms: restoreMs, backup: newest.name, counts: res, synthetic: true });
  console.log("RESTORE_EVIDENCE " + JSON.stringify(evidence));
});

test("retention removes old copies and the files only they used", async () => {
  const ms = await listManifests(store); assert.ok(ms.length >= 3);
  const far = new Date(Date.now() + 200 * 864e5); // 200 days later: the daily copies of today are past their 14 days
  const r: any = await runBackup(db, { store, now: far });
  const left = await listManifests(store); assert.ok(left.length < ms.length + 1, `kept ${left.length} of ${ms.length + 1}`); assert.ok(left.some((m) => m.name === r.name));
});

// P9-R1 (R9, R11): from v26 the backup holds EVERY Workspace table. After wiping all of them, the restore brings each
// back row for row (checksums per table): people and access, records and document versions, workflows, approvals and
// policies with their history, CRM capabilities and settings, management, manufacturing tables and audit trails.
test("every table: a full wipe is restored row for row (workflows, policies, CRM, management, manufacturing, audit)", async () => {
  const tables: string[] = (await sql("select unnest(public.backup_tables()) t")).map((r: any) => r.t);
  for (const t of ["records", "profiles", "section_access", "document_versions", "wf_definitions", "wf_instances", "approval_policies", "approval_policies_history",
    "crm_caps", "crm_settings", "crm_audit", "management_settings", "mfg_settings", "mfg_locations", "mfg_bom_lines", "mfg_stock", "mfg_serials", "mfg_audit", "activity", "comments", "notifications"])
    assert.ok(tables.includes(t), `${t} is in the backup`);
  for (const t of ["ai_cache", "rate_limits", "push_subs"]) assert.ok(!tables.includes(t), `${t} is not backed up (cache / counters / device endpoints)`);
  // synthetic rows in the newer tables so the drill restores more than seeds
  await sql(`insert into public.mfg_locations(code, name) values ($1, 'Synthetic rack') on conflict do nothing`, [`RK-${run}`.toUpperCase().slice(0, 30)]);
  await sql("insert into public.crm_caps(user_id, cap, granted_by) values ($1, 'proposal_approver', $1) on conflict do nothing", [owner.id]);
  const fp = async () => {
    const out: Record<string, string> = {};
    for (const t of tables) {
      if (t === "ops_state") continue; // the backup writes its own run state after collecting the data
      const r = await sql(`select count(*)::int n, coalesce(md5(string_agg(md5(x::text), ',' order by md5(x::text))), '') h from public.${t} x`);
      out[t] = `${r[0].n}:${r[0].h}`;
    }
    return out;
  };
  const b: any = await runBackup(db, { store, now: new Date(Date.now() + 10 * 864e5) });
  assert.equal(b.verified, true);
  const before = await fp();
  const nonEmpty = Object.entries(before).filter(([, v]) => !v.startsWith("0:")).length;
  assert.ok(nonEmpty >= 12, `at least 12 tables hold rows (${nonEmpty})`);
  // the disaster: every Workspace table, the files and the sign-in accounts
  await sql(`truncate ${tables.filter((t) => t !== "ops_state").map((t) => `public.${t}`).join(", ")} cascade`);
  await sql("delete from storage.objects where bucket_id = 'files'"); fs.rmSync(path.join(ENV.STACK_DIR, "storage", "files"), { recursive: true, force: true });
  await sql("delete from auth.users");
  const t1 = Date.now();
  const file = await store.get(b.name);
  const t0s = new Date().toISOString();
  const res: any = await restoreInto(db, file!, pass, store, { anon: anon() });
  evidence.full_restore_ms = Date.now() - t1; evidence.full_restore_tables = Object.keys(res).length;
  // P9-R2 R2-9: the restore paused triggers — every one is enabled again, constraints valid, functions and RLS as in the source
  const pv = res.post_verify;
  assert.equal(pv.triggers_ok, true, `triggers (${JSON.stringify(pv.disabled_triggers)})`); assert.equal(pv.constraints_ok, true, `constraints (${JSON.stringify(pv.invalid_constraints)})`);
  assert.equal(pv.functions_ok, true, "functions as in the source"); assert.equal(pv.rls_ok, true, `RLS (${JSON.stringify(pv.tables_without_rls)})`); assert.equal(pv.rls_probe, true, "an anonymous caller reads nothing");
  const after = await fp();
  const diff = Object.keys(before).filter((t) => before[t] !== after[t]);
  assert.deepEqual(diff, [], `tables restored exactly (differ: ${diff.join(", ")})`);
  for (const [p, bytes] of Object.entries(files)) { const d = await db.storage.from("files").download(p); assert.ifError(d.error); assert.ok(Buffer.from(await d.data!.arrayBuffer()).equals(bytes), `${p} bytes`); }
  // the system works after the restore: a person signs in (new password after recovery) and reads by the same rules
  await db.auth.admin.updateUserById(owner.id, { password: PASSWORD });
  const { c } = await signIn(owner.email);
  const r = await c.from("records").select("id").limit(1); assert.equal(r.error, null);
  fs.writeFileSync(path.join(ENV.STACK_DIR, "p9-restore.json"), JSON.stringify({ tables: tables.length, non_empty: nonEmpty, restore_ms: evidence.full_restore_ms, backup_bytes: b.bytes }, null, 1));
  // acceptance evidence of this local drill (informational: a local drill never certifies a hosted restore)
  if (ENV.ACCEPTANCE_RUN) {
    const { row } = await import("../../scripts/acceptance/evidence.mjs");
    const ev = await (row as any)("P9.RESTORE.LOCAL", "local", { status: "PASS", source: "tests/integration/backup.test.ts (every-table drill)", source_ref: `restore drill ${ENV.ACCEPTANCE_RUN}`, started_at: t0s,
      summary: `${tables.length} tables, ${nonEmpty} non-empty, restored row for row; triggers, constraints, functions and RLS verified`,
      metrics: { source_backup: b.name, target: "local stack (same database after a full wipe)", duration_ms: evidence.full_restore_ms, tables_expected: tables.length - 1, tables_restored: tables.length - 1 - diff.length,
        rows_verified: diff.length === 0, files_expected: Object.keys(files).length, files_verified: true, post_verify: pv, regression_run: ENV.ACCEPTANCE_RUN } }, null);
    fs.mkdirSync(ENV.ACCEPTANCE_EVD, { recursive: true }); fs.writeFileSync(path.join(ENV.ACCEPTANCE_EVD, `${ENV.ACCEPTANCE_RUN}.restore-local.json`), JSON.stringify(ev, null, 1));
  }
});

test("post-restore verification: a trigger left disabled, an invalid constraint or a table without RLS fails it", async () => {
  const { data: src } = await db.rpc("acceptance_integrity");
  await sql("alter table public.records disable trigger user");
  try { const v: any = await postRestoreVerify(db, src, anon()); assert.equal(v.triggers_ok, false); assert.ok(v.disabled_triggers.some((x: string) => x.startsWith("records."))); }
  finally { await sql("alter table public.records enable trigger user"); }
  await sql("alter table public.faq disable row level security");
  try { const v: any = await postRestoreVerify(db, src, null); assert.equal(v.rls_ok, false); assert.ok(v.tables_without_rls.includes("faq")); }
  finally { await sql("alter table public.faq enable row level security"); }
  // without the source's snapshot (an older backup) nothing is assumed: the comparison is unknown, never true
  const v: any = await postRestoreVerify(db, null, null); assert.equal(v.functions_ok, null); assert.equal(v.triggers_ok, null);
  const ok: any = await postRestoreVerify(db, src, anon()); assert.equal(ok.triggers_ok && ok.constraints_ok && ok.functions_ok && ok.rls_ok, true);
});
