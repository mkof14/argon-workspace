// P9-R2 — the deterministic acceptance engine (src/lib/acceptance.ts) and the package (acceptance-package.ts).
// One test per rule in R2-30; the database-level rules (append-only, owner-only closure, refused PASS without
// evidence, unauthorized employee) are tested on the isolated stack in tests/integration/p9r2.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, evaluateActions, gates, scrub, containsSecret, backupLadder, productionTouch, type Check, type Evidence, type Identity, type Finding, type OwnerAction, type ActionEvent } from "../src/lib/acceptance.ts";
import { buildPackage } from "../src/lib/acceptance-package.ts";

const SHA = "a".repeat(40), OLD = "b".repeat(40), NOW = Date.parse("2026-10-24T22:00:00Z");
const ID: Identity = { environment: "staging", app_version: "2.43", git_sha: SHA, db_version: 27, migration_hash: "m" };
const chk = (id: string, kind: string, o: Partial<Check> = {}): Check => ({ id, phase: "P9", name: id, kind, freshness: "release", envs: [], gates: ["staging", "production"], mandatory: true, params: {}, attestable: false, sort: 0, ...o });
let seq = 0;
const ev = (check_id: string, metrics: Record<string, any>, o: Partial<Evidence> = {}): Evidence => ({ id: `e${++seq}`, seq, check_id, status: "PASS", environment: "local", app_version: "2.43", git_sha: SHA, db_version: 27, migration_hash: "m",
  started_at: "2026-10-24T20:00:00Z", completed_at: "2026-10-24T21:00:00Z", source: "tool", source_ref: `run-${seq}`, recorded_at: "2026-10-24T21:00:00Z", recorded_via: "service", summary: null, metrics, blocker: null, ...o });
const one = (c: Check, rows: Evidence[], id: Identity = ID, live: any = { at: "2026-10-24T22:00:00Z" }) => evaluate({ checks: [c], evidence: rows, identity: id, live, now: NOW })[0];
const REG = chk("P9.REG.FULL", "regression", { params: { scope: ["P1", "P9"] } });
const goodReg = (o: Partial<Evidence> = {}, m: Record<string, any> = {}) => ev("P9.REG.FULL", { mode: "full_clean", env_recreated: true, reruns: 0, tests: 10, passed: 10, failed: 0, skipped: 0, scope: ["P1", "P9"], suites: { rls: { tests: 3, passed: 3, failed: 0 } }, ...m }, o);

test("1. a PASS requires evidence", () => {
  const r = one(REG, [goodReg({ source_ref: null })]); assert.equal(r.status, "NOT VERIFIED"); assert.match(r.reason, /without evidence/);
  const r2 = one(REG, [goodReg({}, {})]); assert.equal(r2.status, "PASS");
  const empty = one(chk("P9.AUDIT", "audit"), [ev("P9.AUDIT", {})]); assert.equal(empty.status, "NOT VERIFIED");
});
test("2 & 15. evidence for another SHA does not certify this release (an old-SHA regression does not certify the new SHA)", () => {
  const r = one(REG, [goodReg({ git_sha: OLD })]); assert.equal(r.status, "NOT RUN"); assert.match(r.reason, /does not certify/);
  const both = one(REG, [goodReg({ git_sha: OLD }), goodReg()]); assert.equal(both.status, "PASS");
  const v = one(REG, [goodReg({ db_version: 26 })]); assert.notEqual(v.status, "PASS");
  assert.notEqual(one(REG, [goodReg()], { ...ID, git_sha: "" }).status, "PASS", "a build without a SHA cannot match release evidence");
});
test("3. local performance does not certify staging", () => {
  const c = chk("P9.PERF.STAGING", "performance", { freshness: "environment", envs: ["staging", "production"] });
  const rows = [{ path: "x", p95: 10, pass: true }];
  assert.notEqual(one(c, [ev(c.id, { tier: "local", rows })]).status, "PASS");
  assert.notEqual(one(c, [ev(c.id, { tier: "local", rows }, { environment: "staging" })]).status, "PASS", "LOCAL tier never counts even if mislabeled");
  assert.match(one(c, [ev(c.id, { tier: "local", rows }, { environment: "staging" })]).reason, /LOCAL PERFORMANCE/);
  assert.equal(one(c, [ev(c.id, { tier: "staging", rows }, { environment: "staging" })]).status, "PASS");
});
test("4. a synthetic migration rehearsal does not certify production-data compatibility", () => {
  const c = chk("P9.MIGRATION.PRODCOPY", "migration", { envs: ["production-copy"], params: { source: "production_copy" } });
  const m = { existing_records_identical: true, rollback_ok: true, remigration_identical: true, old_app_smoke: true, new_app_smoke: true };
  assert.notEqual(one(c, [ev(c.id, { ...m, source: "synthetic" }, { environment: "local" })]).status, "PASS");
  const r = one(c, [ev(c.id, { ...m, source: "synthetic" }, { environment: "production-copy" })]); assert.equal(r.status, "NOT VERIFIED"); assert.match(r.reason, /synthetic/);
  assert.equal(one(c, [ev(c.id, { ...m, source: "production_copy" }, { environment: "production-copy" })]).status, "PASS");
});
test("5. a short endurance run does not certify the 24-hour gate (TOOL CHECK)", () => {
  const c = chk("P9.ENDURANCE", "endurance", { freshness: "environment", envs: ["staging"], params: { min_minutes: 1440 } });
  const r = one(c, [ev(c.id, { minutes: 2, continuous: true }, { environment: "staging" })]); assert.equal(r.status, "NOT VERIFIED"); assert.match(r.reason, /TOOL CHECK — NOT ACCEPTANCE EVIDENCE/);
  assert.equal(one(c, [ev(c.id, { minutes: 1441, continuous: true }, { environment: "staging" })]).status, "PASS");
});
test("6. unit MFA tests do not certify live MFA", () => {
  const c = chk("P9.MFA.LIVE.STAGING", "mfa_live", { freshness: "validation", envs: ["staging"], attestable: true });
  const steps = { enroll: true, verify: true, logout: true, login: true, new_browser: true, revoke: true, recovery: true, disabled: true };
  assert.notEqual(one(c, [ev(c.id, { steps }, { environment: "staging", source: "unit tests" })]).status, "PASS");
  assert.notEqual(one(c, [ev(c.id, { steps }, { environment: "staging", recorded_via: "service" })]).status, "PASS", "only the owner's live attestation counts");
  assert.notEqual(one(c, [ev(c.id, { steps: { ...steps, new_browser: false } }, { environment: "staging", recorded_via: "owner" })]).status, "PASS");
  assert.equal(one(c, [ev(c.id, { steps }, { environment: "staging", recorded_via: "owner", source: "owner attestation" })]).status, "PASS");
  assert.equal(one(c, []).status, "OWNER ACTION REQUIRED");
});
test("7. backup code does not certify a real backup", () => {
  const c = chk("P9.BACKUP.PRODUCTION", "backup_artifact", { freshness: "operational", envs: ["production"], params: { offsite: true } });
  assert.equal(one(c, [], { ...ID, environment: "production" }).status, "OWNER ACTION REQUIRED");
  const lad = backupLadder({ at: "x", environment: "production", backup: { state: null, last_job: null, last_success: null }, integrations: { backup_passphrase: false } } as any, [], undefined, NOW);
  assert.equal(lad.real_backup, false); assert.equal(lad.rungs[0].ok, true, "code exists"); assert.equal(lad.rungs[4].ok, false, "but no artifact");
});
test("8. a backup artifact without integrity verification is insufficient", () => {
  const c = chk("P9.BACKUP.PRODUCTION", "backup_artifact", { freshness: "operational", envs: ["production"], params: { offsite: true } });
  const r = one(c, [ev(c.id, { artifact: "db/x.agronbackup", bytes: 100, integrity_verified: false, offsite: true }, { environment: "production", completed_at: "2026-10-24T21:00:00Z" })], { ...ID, environment: "production" });
  assert.equal(r.status, "NOT VERIFIED"); assert.match(r.reason, /integrity/);
  assert.notEqual(one(c, [ev(c.id, { artifact: "a", bytes: 1, integrity_verified: true, offsite: false }, { environment: "production" })], { ...ID, environment: "production" }).status, "PASS", "not off-project");
  assert.equal(one(c, [ev(c.id, { artifact: "a", bytes: 1, integrity_verified: true, offsite: true }, { environment: "production" })], { ...ID, environment: "production" }).status, "PASS");
  assert.equal(one(c, [ev(c.id, { artifact: "a", bytes: 1, integrity_verified: true, offsite: true }, { environment: "production", completed_at: "2026-10-20T00:00:00Z" })], { ...ID, environment: "production" }).status, "NOT VERIFIED", "too old (operational freshness)");
});
test("9. a restore without post-restore trigger/constraint/function/RLS verification is insufficient", () => {
  const c = chk("P9.RESTORE.STAGING", "restore_drill", { freshness: "environment", envs: ["staging"] });
  const base = { source_backup: "db/x", tables_expected: 81, tables_restored: 81, rows_verified: true, files_expected: 2, files_verified: true };
  assert.equal(one(c, [ev(c.id, base, { environment: "staging" })]).status, "NOT VERIFIED");
  assert.equal(one(c, [ev(c.id, { ...base, post_verify: { triggers_ok: true, constraints_ok: true, functions_ok: null, rls_ok: true } }, { environment: "staging" })]).status, "NOT VERIFIED", "unknown is not true");
  assert.equal(one(c, [ev(c.id, { ...base, post_verify: { triggers_ok: true, constraints_ok: true, functions_ok: true, rls_ok: true } }, { environment: "staging" })]).status, "PASS");
  assert.notEqual(one(c, [ev(c.id, { ...base, post_verify: { triggers_ok: true, constraints_ok: true, functions_ok: true, rls_ok: true } }, { environment: "local" })]).status, "PASS", "a local drill does not certify a hosted restore");
});
test("10. browser emulation does not certify a real device", () => {
  const c = chk("P9.DEVICES", "real_devices", { freshness: "validation", envs: ["staging"], attestable: true, params: { classes: ["phone"] } });
  const d = (mode: string) => ev(c.id, { mode, devices: [{ class: "phone", os: "iOS 18", browser: "Safari", completed: 12, failed: 0 }] }, { environment: "staging", recorded_via: "owner" });
  assert.notEqual(one(c, [d("emulation")]).status, "PASS");
  assert.notEqual(one(c, [ev(c.id, { mode: "real_device", devices: [{ class: "phone", browser: "Playwright viewport emulation", completed: 12, failed: 0 }] }, { environment: "staging", recorded_via: "owner" })]).status, "PASS");
  assert.equal(one(c, [d("real_device")]).status, "PASS");
});
test("11. synthetic personas do not certify the real-user gate", () => {
  const c = chk("P9.USERS", "real_users", { freshness: "validation", envs: ["staging"], attestable: true });
  assert.notEqual(one(c, [ev(c.id, { participants: 13, tasks_attempted: 33, synthetic: true }, { environment: "staging", recorded_via: "owner" })]).status, "PASS");
  assert.notEqual(one(c, [ev(c.id, { participants: 3, tasks_attempted: 33, synthetic: false }, { environment: "staging", recorded_via: "service" })]).status, "PASS");
  assert.equal(one(c, [ev(c.id, { participants: 3, tasks_attempted: 33, synthetic: false }, { environment: "staging", recorded_via: "owner" })]).status, "PASS");
});
test("12. a Draft policy does not certify approved policy (live state)", () => {
  const c = chk("P9.POLICIES.PRODUCTION", "policies", { freshness: "live", envs: ["production"] });
  const pol = (status: string) => ({ code: "PURCHASE", name: "", version: 1, status, active: true, seeded: true, approved_by: null, approved_at: null, approved_version: null, owner_approved: status === "Approved", currency: null, chain: [] });
  const prod = { ...ID, environment: "production" };
  assert.equal(one(c, [], prod, { at: "2026-10-24T22:00:00Z", policies: [pol("Draft"), { ...pol("Approved"), code: "PAYMENT" }] }).status, "OWNER ACTION REQUIRED");
  assert.equal(one(c, [], prod, { at: "2026-10-24T22:00:00Z", policies: [pol("Approved")] }).status, "PASS");
  assert.equal(one(c, [], ID, { at: "2026-10-24T22:00:00Z", policies: [pol("Approved")] }).status, "OWNER ACTION REQUIRED", "staging's policies are not production's");
});
const ACTION: OwnerAction = { id: 4, category: "Critical now", title: "Close public registration", action: "", where_: "", why: "", blocks_staging: true, blocks_production: true, closure_evidence: "", closes_with: ["P9.SIGNUP.STAGING"] };
test("13. an owner action cannot be closed by unrelated code evidence", () => {
  const signup = chk("P9.SIGNUP.STAGING", "signup", { freshness: "operational", envs: ["staging"] });
  const reg = goodReg(); const sig = ev(signup.id, { disable_signup: true }, { environment: "staging" });
  const results = evaluate({ checks: [REG, signup], evidence: [reg, sig], identity: ID, live: { at: "x" }, now: NOW });
  const close = (ids: string[], role = "owner"): ActionEvent => ({ id: 1, action_id: 4, event: "closed", evidence_ids: ids, note: null, actor: "u", actor_role: role, at: "2026-10-24T21:30:00Z" });
  assert.equal(evaluateActions([ACTION], [close([reg.id])], results, [reg, sig])[0].status, "OWNER ACTION REQUIRED", "regression evidence cannot close the sign-up action");
  assert.equal(evaluateActions([ACTION], [close([sig.id], "admin")], results, [reg, sig])[0].status, "OWNER ACTION REQUIRED", "an administrator cannot close it");
  assert.equal(evaluateActions([ACTION], [], results, [reg, sig])[0].reason, "evidence present — waits for the owner to close it");
  assert.equal(evaluateActions([ACTION], [close([sig.id])], results, [reg, sig])[0].status, "CLOSED");
  const enabled = ev(signup.id, { disable_signup: false }, { environment: "staging", status: "OWNER ACTION REQUIRED" });
  const later = evaluate({ checks: [REG, signup], evidence: [reg, sig, enabled], identity: ID, live: { at: "x" }, now: NOW });
  assert.equal(evaluateActions([ACTION], [close([sig.id])], later, [reg, sig, enabled])[0].status, "OWNER ACTION REQUIRED", "closed, but sign-up was switched on again");
});
test("14. a staging result does not certify production", () => {
  const c = chk("P9.SIGNUP.PRODUCTION", "signup", { freshness: "operational", envs: ["production"] });
  const r = one(c, [ev(c.id, { disable_signup: true }, { environment: "staging" })]); assert.notEqual(r.status, "PASS"); assert.match(r.reason, /staging result does not certify production/);
});
test("16 & 17. a partial run or an isolated rerun does not satisfy the full regression gate", () => {
  assert.match(one(REG, [goodReg({}, { mode: "partial" })]).reason, /PARTIAL TEST/);
  assert.match(one(REG, [goodReg({}, { mode: "isolated_rerun" })]).reason, /ISOLATED RERUN/);
  assert.notEqual(one(REG, [goodReg({}, { reruns: 1 })]).status, "PASS");
  assert.notEqual(one(REG, [goodReg({}, { env_recreated: false })]).status, "PASS");
  assert.notEqual(one(REG, [goodReg({}, { skipped: 2 })]).status, "PASS");
  assert.notEqual(one(REG, [goodReg({}, { dirty: true })]).status, "PASS", "uncommitted changes: the SHA does not identify what ran");
  assert.notEqual(one(REG, [goodReg({}, { scope: ["P1"] })]).status, "PASS");
  // a derived suite check follows its run
  const rls = chk("P9.SEC.RLS", "suite", { params: { from: "P9.REG.FULL", suites: ["rls"] } });
  assert.equal(evaluate({ checks: [REG, rls], evidence: [goodReg()], identity: ID, live: { at: "x" }, now: NOW })[1].status, "PASS");
  assert.notEqual(evaluate({ checks: [REG, rls], evidence: [goodReg({}, { mode: "partial" })], identity: ID, live: { at: "x" }, now: NOW })[1].status, "PASS");
});
const allPass = () => { const c = chk("X", "audit"); return evaluate({ checks: [c], evidence: [ev("X", { vulnerabilities: { total: 0 }, production_vulnerabilities: { total: 0 } })], identity: ID, live: { at: "x" }, now: NOW }); };
const F = (sev: Finding["severity"], gate: Finding["blocking_gate"], state: Finding["state"] = "open"): Finding => ({ seq: 1, finding_id: `F-${sev}`, severity: sev, description: "d", state, owner: "o", blocking_gate: gate, recorded_at: "x", source: "s" });
test("18 & 19. Production Ready is never true with an open P0 or an open blocking P1", () => {
  const ok = gates(allPass(), [], []); assert.equal(ok.production.ready, true);
  assert.equal(gates(allPass(), [], [F("P0", "none")]).production.ready, false);
  assert.equal(gates(allPass(), [], [F("P0", "none")]).staging.ready, false, "an open P0 blocks every gate");
  assert.equal(gates(allPass(), [], [F("P1", "production")]).production.ready, false);
  assert.equal(gates(allPass(), [], [F("P1", "production")]).staging.ready, true, "a production-blocking P1 does not block staging");
  assert.equal(gates(allPass(), [], [F("P1", "production", "fixed")]).production.ready, true);
});
test("20 & 21. Production Live needs the owner's authorisation, a completed deployment and the production smoke", () => {
  const prod = { ...ID, environment: "production" };
  const auth = chk("P9.LIVE.AUTHORIZATION", "owner_authorization", { envs: ["production"], gates: ["live"], attestable: true });
  const dep = chk("P9.LIVE.DEPLOYED", "production_deploy", { envs: ["production"], gates: ["live"] });
  const smoke = chk("P9.LIVE.SMOKE", "production_smoke", { envs: ["production"], gates: ["live"] });
  const E = { a: ev(auth.id, { decision: "authorized" }, { environment: "production", recorded_via: "owner" }), d: ev(dep.id, { deployment_id: "dpl", sha: SHA }, { environment: "production" }), s: ev(smoke.id, { passed: true }, { environment: "production" }) };
  const live = (rows: Evidence[]) => gates(evaluate({ checks: [auth, dep, smoke], evidence: rows, identity: prod, live: { at: "x" }, now: NOW }), [], []).live;
  assert.equal(live([E.d, E.s]).ready, false, "no authorisation");
  assert.equal(live([{ ...E.a, recorded_via: "service" }, E.d, E.s]).ready, false, "an authorisation not from the owner does not count");
  assert.equal(live([E.a, E.d]).ready, false, "no production smoke");
  assert.equal(live([E.a, E.s]).ready, false, "no deployment");
  assert.equal(live([{ ...E.a, git_sha: OLD }, E.d, E.s]).ready, false, "authorisation for another release");
  assert.equal(live([E.a, E.d, E.s]).ready, true);
});
test("23. the export contains no secrets", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc2lnbmF0dXJl";
  const s = scrub({ metrics: { service_role_key: "abc", note: `key ${jwt}`, url: "postgresql://u:p@h/db", backup_passphrase: true, count: 3 } }) as any;
  assert.deepEqual((scrub({ secret_rotation: [{ what: "rotated" }] }) as any).secret_rotation, [{ what: "rotated" }], "a structure under a secret-named key is kept and walked");
  assert.equal(s.metrics.service_role_key, "[removed]"); assert.equal(s.metrics.note, "[removed]"); assert.equal(s.metrics.url, "[removed]"); assert.equal(s.metrics.backup_passphrase, true); assert.equal(s.metrics.count, 3);
  const p = buildPackage({ identity: ID, checks: [REG], evidence: [goodReg({ summary: jwt }, { note: "sk-ant-api03-secretvalue" })], live: { at: "x" }, actions: [], events: [], findings: [], changes: [], now: NOW });
  const text = JSON.stringify(p.json) + p.md; assert.equal(containsSecret(text), false);
});
test("24 & 25. superseded evidence stays visible; the newest execution decides", () => {
  const fail = goodReg({ status: "FAIL", blocker: "2 failed" }, { failed: 2, passed: 8 }); const pass = goodReg();
  const r = one(REG, [fail, pass]); assert.equal(r.status, "PASS"); assert.equal(r.history, 2); assert.equal(r.superseded, 1);
  const r2 = one(REG, [pass, { ...fail, id: "late", seq: 999 }]); assert.equal(r2.status, "FAIL", "a newer failure is never hidden by an older pass");
  const p = buildPackage({ identity: ID, checks: [REG], evidence: [fail, pass], live: { at: "x" }, actions: [], events: [], findings: [], changes: [], now: NOW });
  assert.equal(p.json.regression.register.length, 2, "both runs are in the register");
});
test("freshness: stale environment evidence no longer counts (SYSTEM DEFAULT — OWNER MAY CHANGE)", () => {
  const c = chk("P9.SEC.STAGING", "security_suite", { freshness: "environment", envs: ["staging"] });
  const old = ev(c.id, { checks: 500, findings: 0 }, { environment: "staging", completed_at: "2026-09-01T00:00:00Z" });
  const r = one(c, [old]); assert.equal(r.status, "NOT VERIFIED"); assert.equal(r.stale, true); assert.match(r.reason, /SYSTEM DEFAULT — OWNER MAY CHANGE/);
  assert.equal(evaluate({ checks: [c], evidence: [old], identity: ID, live: { at: "x" }, settings: { environment_days: 90 }, now: NOW })[0].status, "PASS", "the owner may change the limit");
});
test("production touch: the statement is supported only by the change log plus a production probe", () => {
  const none = productionTouch([], undefined, "2026-10-19T00:54:00Z"); assert.equal(none.touched, null); assert.match(none.statement, /cannot be supported/);
  const probe: any = { evidence: { completed_at: "2026-10-24T22:00:00Z", source_ref: "p", metrics: { touched: false } }, stale: false };
  assert.equal(productionTouch([], probe, "2026-10-19T00:54:00Z").touched, false);
  assert.equal(productionTouch([{ at: "2026-10-20T00:00:00Z", environment: "production", category: "role_change", what: "x" }], probe, "2026-10-19T00:54:00Z").touched, true);
});
test("the Markdown package has exactly the 15 sections of R2-24", () => {
  const p = buildPackage({ identity: ID, checks: [REG], evidence: [goodReg()], live: { at: "x" }, actions: [ACTION], events: [], findings: [F("P1", "production")], changes: [], now: NOW });
  const heads = p.md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
  assert.deepEqual(heads, ["1. Release Identity", "2. Current Readiness", "3. Open Findings", "4. Full Regression", "5. Security", "6. Backup / Restore", "7. Policies", "8. Users / Access", "9. Staging", "10. Migration", "11. Production", "12. Owner Actions", "13. Blocking Gates", "14. Final Machine Verdict", "15. Evidence Integrity"]);
  assert.match(p.md, /^# AGRON WORKSPACE — ACCEPTANCE PACKAGE/);
  assert.match(p.md, /PRODUCTION READY: NO/);
});
