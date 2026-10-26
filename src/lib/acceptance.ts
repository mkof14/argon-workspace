// Acceptance evidence — the deterministic readiness engine (P9-R2). Pure functions, no I/O, no AI.
//
// Input: the check catalog, the recorded evidence (append-only rows from supabase/update-v27.sql), the live system
// state, owner actions and their closure events, findings and settings, and the identity of the release that is
// being judged (environment, app version, Git SHA, database version, migration set).
// Output: one result per check, the gates (DEVELOPMENT ACCEPTED, STAGING READY, PRODUCTION READY, PRODUCTION LIVE)
// with every unmet requirement, and the summary the Evidence Center and the acceptance package show.
//
// Rules that are never relaxed:
//  - a PASS counts only with evidence (source, execution reference, completion time, metrics);
//  - evidence is bound to its release (Git SHA, app version, database version) and to the environments the check
//    accepts — a result for SHA A never certifies SHA B, a staging result never certifies production, a local result
//    never certifies staging;
//  - evidence has an age; past its freshness class it no longer counts;
//  - each kind has its own proof (a 24-hour run for endurance, an integrity-verified artifact for backup, a
//    post-restore trigger/constraint/function/RLS check for restore, real people for real-user tests …);
//  - a mandatory failed gate is never outweighed by anything else; there is no score.
export const STATUSES = ["PASS", "FAIL", "NOT RUN", "NOT VERIFIED", "OWNER ACTION REQUIRED", "BLOCKED", "IN PROGRESS"] as const;
export type Status = (typeof STATUSES)[number];
export type Gate = "development" | "staging" | "production" | "live";
export type Env = "local" | "ci" | "preview" | "staging" | "production" | "production-copy";

export type Check = {
  id: string; phase: string; name: string; kind: string; freshness: "release" | "environment" | "operational" | "validation" | "live";
  envs: string[]; gates: string[]; mandatory: boolean; params: Record<string, any>; attestable: boolean; sort: number; description?: string | null;
};
export type Evidence = {
  id: string; seq: number; check_id: string; status: Status; environment: string; app_version: string | null; git_sha: string | null; db_version: number | null;
  migration_hash: string | null; started_at: string | null; completed_at: string | null; source: string; source_ref: string | null; recorded_at: string;
  recorded_via: "service" | "owner" | "system"; recorded_by?: string | null; summary: string | null; metrics: Record<string, any>; blocker: string | null;
};
export type Identity = { environment: string; app_version: string; git_sha: string; db_version: number | null; migration_hash: string; dirty?: boolean };
export type Settings = { environment_days: number; operational_hours: number; validation_days: number; require_pilot: boolean; label?: string };
export const DEFAULT_SETTINGS: Settings = { environment_days: 14, operational_hours: 26, validation_days: 90, require_pilot: false, label: "SYSTEM DEFAULT — OWNER MAY CHANGE" };
export type OwnerAction = { id: number; category: string; title: string; action: string; where_: string; why: string; blocks_staging: boolean; blocks_production: boolean; closure_evidence: string; closes_with: string[] };
export type ActionEvent = { id: number; action_id: number; event: "closed" | "reopened"; evidence_ids: string[]; note: string | null; actor: string; actor_role?: string | null; at: string };
export type Finding = { seq: number; finding_id: string; severity: "P0" | "P1" | "P2" | "P3"; description: string; state: "open" | "fixed" | "mitigated" | "accepted"; owner: string; blocking_gate: "none" | Gate; recorded_at: string; source: string };
export type Live = {
  at: string; environment?: string; db_version?: number | null;
  policies?: { code: string; name: string; version: number; status: string; active: boolean; seeded: boolean; approved_by: string | null; approved_at: string | null; approved_version: number | null; owner_approved: boolean; currency: string | null; chain: any; ready_for_approval?: boolean | null; model_version?: number | null; self_approved?: boolean | null }[];
  access?: Record<string, any>; backup?: { state: any; last_job: any; last_success: string | null }; integrity?: any;
  signup?: { disable_signup: boolean | null; at: string; error?: string }; integrations?: Record<string, boolean>;
};
export type Result = {
  id: string; name: string; kind: string; phase: string; gates: string[]; mandatory: boolean; freshness: Check["freshness"]; envs: string[];
  status: Status; counts: boolean; reason: string; evidence: Evidence | null; verified_at: string | null; age_hours: number | null; stale: boolean;
  history: number; superseded: number; note?: string;
};

const H = 3600e3;
const pick = (m: any, k: string) => (m && typeof m === "object" ? m[k] : undefined);
export const shortSha = (s?: string | null) => (s ? s.slice(0, 12) : "unknown");
const sameSha = (a?: string | null, b?: string | null) => !!a && !!b && (a.length >= 12 && b.length >= 12) && (a.startsWith(b) || b.startsWith(a));
export const isProductionTarget = (env: string) => env === "production";

/** Does this row belong to the release and the environments the check accepts? null = yes, otherwise why not. */
export function binding(c: Check, e: Evidence, id: Identity): string | null {
  if (c.envs.length && !c.envs.includes(e.environment)) {
    if (e.environment === "local" || e.environment === "ci") return `a ${e.environment} result does not certify ${c.envs.join("/")}`;
    if (e.environment === "staging" && c.envs.includes("production")) return "a staging result does not certify production";
    return `a ${e.environment} result does not certify ${c.envs.join("/")}`;
  }
  if (c.freshness === "release" || c.freshness === "environment") {
    if (!id.git_sha) return "this build does not know its Git SHA, so no release evidence can be matched";
    if (!sameSha(e.git_sha, id.git_sha)) return `recorded for SHA ${shortSha(e.git_sha)} — does not certify ${shortSha(id.git_sha)}`;
    if (e.app_version && id.app_version && e.app_version !== id.app_version) return `recorded for app ${e.app_version} — this is ${id.app_version}`;
    if (e.db_version != null && id.db_version != null && e.db_version !== id.db_version) return `recorded for database v${e.db_version} — this is v${id.db_version}`;
  }
  return null;
}

/** Age limit of a freshness class in hours (null = no time limit, bound to the release instead). */
export function maxAgeHours(c: Check, s: Settings): number | null {
  if (c.freshness === "environment") return s.environment_days * 24;
  if (c.freshness === "operational") return s.operational_hours;
  if (c.freshness === "validation") return s.validation_days * 24;
  return null;
}

const ok = (v: any) => v === true;
/** The proof each kind requires of a PASS. null = sufficient, otherwise why the PASS does not count. */
export function validate(c: Check, e: Evidence, id: Identity): string | null {
  const m = e.metrics || {};
  if (!e.source_ref || !e.completed_at || !Object.keys(m).length) return "a PASS without evidence (execution reference, completion time, metrics) is rejected";
  if (m.dirty === true) return "recorded from a working tree with uncommitted changes — the SHA does not identify what was tested";
  switch (c.kind) {
    case "regression": {
      if (m.mode === "partial") return "PARTIAL TEST — only a FULL CLEAN REGRESSION satisfies this gate";
      if (m.mode === "isolated_rerun") return "ISOLATED RERUN — only a FULL CLEAN REGRESSION satisfies this gate";
      if (m.mode !== "full_clean") return "the run is not marked as a full clean regression";
      if (m.env_recreated !== true) return "the environment was not recreated before the run";
      if (Number(m.reruns) !== 0) return `${m.reruns} isolated rerun(s) — final evidence needs 0`;
      if (!(Number(m.tests) > 0) || Number(m.passed) !== Number(m.tests) || Number(m.failed) !== 0) return `${m.passed}/${m.tests} passed, ${m.failed} failed`;
      if (Number(m.skipped || 0) !== 0) return `${m.skipped} test(s) skipped`;
      const scope: string[] = c.params?.scope || [];
      const missing = scope.filter((p) => !(m.scope || []).includes(p));
      if (missing.length) return `scope misses ${missing.join(", ")}`;
      return null;
    }
    case "unit": return Number(m.failed) === 0 && Number(m.tests) > 0 && Number(m.passed) === Number(m.tests) ? null : `${m.passed}/${m.tests} passed`;
    case "build": case "typecheck": return Number(m.exit_code) === 0 ? null : `exit code ${m.exit_code}`;
    case "audit": return Number(pick(m.vulnerabilities, "total")) === 0 && Number(pick(m.production_vulnerabilities, "total") ?? 0) === 0 ? null : "vulnerabilities reported";
    case "security_suite": return Number(m.findings) === 0 && Number(m.checks) > 0 ? null : `${m.findings} finding(s) in ${m.checks} checks`;
    case "staging_deployed": return Number(m.health_status) === 200 && ok(m.database) ? null : "staging health is not 200 with a connected database";
    case "personas": return Number(m.count) >= Number(c.params?.min || 1) ? null : `${m.count} personas (need ${c.params?.min})`;
    case "signup": return m.disable_signup === true ? null : "public sign-up is enabled";
    case "probe_isolation": return Number(m.health_status) === 503 && ok(m.refused) ? null : "the preview did not refuse production settings";
    case "mfa_live": {
      if (/unit|integration|test suite/i.test(e.source)) return "automated MFA tests do not certify live MFA";
      if (e.recorded_via !== "owner") return "live MFA needs the owner's attestation from a real account";
      const steps = ["enroll", "verify", "logout", "login", "new_browser", "revoke", "recovery", "disabled"];
      const miss = steps.filter((s) => !ok(pick(m.steps, s)));
      return miss.length ? `steps not verified: ${miss.join(", ")}` : null;
    }
    case "performance": {
      if (m.tier !== "staging" && m.tier !== "production") return "LOCAL PERFORMANCE — does not satisfy the production-grade gate";
      const rows: any[] = m.rows || [];
      if (!rows.length) return "no measured paths";
      const bad = rows.filter((r) => !r.skipped && !r.pass);
      return bad.length ? `${bad.length} path(s) over target` : null;
    }
    case "endurance": {
      const min = Number(c.params?.min_minutes || 1440);
      if (!(Number(m.minutes) >= min)) return `TOOL CHECK — NOT ACCEPTANCE EVIDENCE (${m.minutes ?? 0} min, needs ${min} continuous minutes)`;
      if (m.continuous === false) return "the run was interrupted";
      return null;
    }
    case "real_users": {
      if (e.recorded_via !== "owner") return "real-user results are attested by the owner";
      if (m.synthetic !== false) return "synthetic personas cannot satisfy the real-user gate";
      if (!(Number(m.participants) >= 1) || !(Number(m.tasks_attempted) > 0)) return "no real participants or tasks recorded";
      return null;
    }
    case "real_devices": {
      if (e.recorded_via !== "owner") return "real-device results are attested by the owner";
      const devs: any[] = m.devices || [];
      if (m.mode !== "real_device" || devs.some((d) => /emulat|viewport|simulat/i.test(String(d.mode || d.browser || "")))) return "browser viewport emulation is never real-device evidence";
      const need: string[] = c.params?.classes || [];
      const missing = need.filter((k) => !devs.some((d) => d.class === k && Number(d.failed || 0) === 0 && Number(d.completed || 0) > 0));
      return missing.length ? `device classes without a passed real test: ${missing.join(", ")}` : null;
    }
    case "backup_artifact": {
      if (!m.artifact || !(Number(m.bytes) > 0)) return "no backup artifact";
      if (m.integrity_verified !== true) return "backup artifact without integrity verification is insufficient";
      if (c.params?.offsite && m.offsite !== true) return "the artifact is not stored outside the project";
      return null;
    }
    case "restore_drill": {
      if (!m.source_backup) return "no source backup recorded";
      if (!(Number(m.tables_expected) > 0) || Number(m.tables_restored) !== Number(m.tables_expected)) return `${m.tables_restored}/${m.tables_expected} tables restored`;
      if (m.rows_verified !== true) return "rows/checksums not verified";
      if (Number(m.files_expected || 0) > 0 && m.files_verified !== true) return "files not verified";
      const p = m.post_verify || {};
      if (!(ok(p.triggers_ok) && ok(p.constraints_ok) && ok(p.functions_ok) && ok(p.rls_ok))) return "restore without post-restore verification of triggers, constraints, functions and RLS is insufficient";
      return null;
    }
    case "migration": {
      const src = c.params?.source;
      if (src === "production_copy" && m.source !== "production_copy") return "a synthetic rehearsal does not prove production-data compatibility";
      if (m.source !== src) return `rehearsal source ${m.source} — this check needs ${src}`;
      const need = ["existing_records_identical", "rollback_ok", "remigration_identical", "old_app_smoke", "new_app_smoke"];
      const miss = need.filter((k) => m[k] !== true);
      return miss.length ? `not proven: ${miss.join(", ")}` : null;
    }
    case "access_matrix": {
      if (e.recorded_via !== "owner") return "the access matrix is confirmed by the owner";
      if (m.complete !== true) return "the access matrix is not complete";
      if (Number(m.unresolved_conflicts || 0) > 0) return `${m.unresolved_conflicts} unresolved capability conflict(s)`;
      return null;
    }
    case "owner_attestation": case "pilot": return e.recorded_via === "owner" && m.confirmed === true ? null : "needs the owner's confirmation";
    case "owner_authorization": return e.recorded_via === "owner" && m.decision === "authorized" ? null : m.decision === "refused" ? "the owner refused the deployment" : "no explicit owner authorisation";
    case "production_deploy": return m.deployment_id && sameSha(m.sha, id.git_sha) ? null : "no completed production deployment of this release";
    case "production_smoke": return m.passed === true ? null : "production smoke did not pass";
    case "policies": return Number(m.total) > 0 && Number(m.approved) === Number(m.total) ? null : `${m.approved ?? 0}/${m.total ?? 0} policies approved`;
    case "mfa_coverage": return m.mfa_required === true && Number(m.requiring) > 0 && Number(m.enrolled) === Number(m.requiring) ? null : "MFA not required, or not every owner/administrator is enrolled";
    case "production_touch": return null;
    default: return null;
  }
}

/** What a check shows when there is no evidence that counts. */
function missingStatus(c: Check, ctx: { stagingDeployed: boolean }): { status: Status; reason: string } {
  if (c.attestable) return { status: "OWNER ACTION REQUIRED", reason: "waits for the owner's attestation" };
  // the sign-up setting is read from the project itself (the app's daily snapshot or the probe), not from the staging app
  if (c.kind === "signup") return { status: "OWNER ACTION REQUIRED", reason: `no sign-up probe of ${c.envs.join("/")} recorded (owner action 4)` };
  if (c.kind === "staging_deployed") return { status: "OWNER ACTION REQUIRED", reason: "staging is not deployed yet (owner actions 7–8)" };
  if (c.envs.includes("staging") && !ctx.stagingDeployed) return { status: "BLOCKED", reason: "staging is not deployed" };
  if (c.envs.includes("production") || c.envs.includes("production-copy")) return { status: "OWNER ACTION REQUIRED", reason: "needs the production environment (owner actions)" };
  return { status: "NOT RUN", reason: "no execution recorded" };
}

/** Live checks: evidence computed from the system state of the environment producing the page/package. */
export function liveEvidence(c: Check, live: Live, id: Identity): Evidence | null {
  if (!c.envs.includes(id.environment)) return null;
  const base = { id: `live:${c.id}`, seq: Number.MAX_SAFE_INTEGER, check_id: c.id, environment: id.environment, app_version: id.app_version, git_sha: id.git_sha, db_version: id.db_version,
    migration_hash: id.migration_hash, started_at: live.at, completed_at: live.at, source: "system state", source_ref: `live ${live.at}`, recorded_at: live.at, recorded_via: "system" as const, blocker: null };
  if (c.kind === "policies" && live.policies) {
    const act = live.policies.filter((p) => p.active);
    const approved = act.filter((p) => p.status === "Approved").length;
    const metrics = { total: act.length, approved, owner_approved: act.filter((p) => p.owner_approved).length, pending: act.filter((p) => p.status !== "Approved").map((p) => p.code) };
    return { ...base, status: approved === act.length && act.length > 0 ? "PASS" : "OWNER ACTION REQUIRED", summary: `${approved}/${act.length} approved`, metrics };
  }
  if (c.kind === "mfa_coverage" && live.access) {
    const a = live.access; const metrics = { mfa_required: !!a.mfa_required, requiring: a.requiring_mfa ?? 0, enrolled: a.privileged_with_mfa ?? null };
    return { ...base, status: metrics.mfa_required && metrics.requiring > 0 && metrics.enrolled === metrics.requiring ? "PASS" : "OWNER ACTION REQUIRED", summary: `${metrics.enrolled ?? "?"}/${metrics.requiring} owners/admins enrolled; required: ${metrics.mfa_required}`, metrics };
  }
  if (c.kind === "signup" && live.signup && live.signup.disable_signup != null) {
    const metrics = { disable_signup: live.signup.disable_signup, probed_at: live.signup.at };
    return { ...base, completed_at: live.signup.at, status: live.signup.disable_signup ? "PASS" : "OWNER ACTION REQUIRED", summary: live.signup.disable_signup ? "public sign-up disabled" : "public sign-up ENABLED", metrics };
  }
  return null;
}

export type Input = { checks: Check[]; evidence: Evidence[]; identity: Identity; live: Live; settings?: Partial<Settings>; now?: number };

export function evaluate(inp: Input): Result[] {
  const s = { ...DEFAULT_SETTINGS, ...(inp.settings || {}) }; const now = inp.now ?? Date.now();
  const byCheck = new Map<string, Evidence[]>();
  for (const e of inp.evidence) { const a = byCheck.get(e.check_id) || []; a.push(e); byCheck.set(e.check_id, a); }
  for (const a of byCheck.values()) a.sort((x, y) => y.seq - x.seq);
  const sorted = [...inp.checks].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const results = new Map<string, Result>();
  const evalOne = (c: Check, stagingDeployed: boolean): Result => {
    const rows = byCheck.get(c.id) || [];
    const lv = c.freshness === "live" || ["signup"].includes(c.kind) ? liveEvidence(c, inp.live, inp.identity) : null;
    const all = lv ? [lv, ...rows] : rows;
    const base = { id: c.id, name: c.name, kind: c.kind, phase: c.phase, gates: c.gates, mandatory: c.mandatory, freshness: c.freshness, envs: c.envs, history: rows.length, superseded: Math.max(0, rows.length - 1) };
    // derived from the per-suite results of another run (e.g. the RLS suite inside the full clean regression)
    if (c.kind === "suite") {
      const src = results.get(c.params?.from);
      if (!src || src.status !== "PASS" || !src.evidence) return { ...base, status: src?.status === "PASS" || !src ? "NOT RUN" : src.status, counts: false, reason: `needs a valid ${c.params?.from} run (${src?.reason || "none"})`, evidence: null, verified_at: null, age_hours: null, stale: false };
      const suites = src.evidence.metrics?.suites || {};
      const names: string[] = c.params?.suites || [];
      const miss = names.filter((n) => !suites[n]); const bad = names.filter((n) => suites[n] && (Number(suites[n].failed) > 0 || !(Number(suites[n].passed) > 0)));
      const st: Status = miss.length ? "NOT VERIFIED" : bad.length ? "FAIL" : "PASS";
      return { ...base, status: st, counts: st === "PASS", reason: miss.length ? `suite(s) not in the run: ${miss.join(", ")}` : bad.length ? `failed in: ${bad.join(", ")}` : `${names.map((n) => `${n} ${suites[n].passed}/${suites[n].tests}`).join(", ")} in run ${src.evidence.source_ref}`,
        evidence: src.evidence, verified_at: src.verified_at, age_hours: src.age_hours, stale: false };
    }
    const bound = all.filter((e) => binding(c, e, inp.identity) === null);
    const latest = bound[0];
    if (!latest) {
      const m = missingStatus(c, { stagingDeployed });
      const other = all[0];
      return { ...base, ...m, reason: other ? `${m.reason}; newest record: ${binding(c, other, inp.identity)}` : m.reason, counts: false, evidence: null, verified_at: null, age_hours: null, stale: false };
    }
    const ts = Date.parse(latest.completed_at || latest.recorded_at); const age = Number.isFinite(ts) ? (now - ts) / H : null;
    const limit = maxAgeHours(c, s); const stale = limit != null && age != null && age > limit;
    if (latest.status !== "PASS") return { ...base, status: latest.status, counts: false, reason: latest.blocker || latest.summary || latest.status, evidence: latest, verified_at: latest.completed_at, age_hours: age, stale };
    const why = validate(c, latest, inp.identity);
    if (why) return { ...base, status: "NOT VERIFIED", counts: false, reason: why, evidence: latest, verified_at: latest.completed_at, age_hours: age, stale };
    if (stale) return { ...base, status: "NOT VERIFIED", counts: false, reason: `stale: verified ${Math.round(age!)} h ago, limit ${limit} h (${s.label || "SYSTEM DEFAULT — OWNER MAY CHANGE"})`, evidence: latest, verified_at: latest.completed_at, age_hours: age, stale };
    return { ...base, status: "PASS", counts: true, reason: latest.summary || "verified", evidence: latest, verified_at: latest.completed_at, age_hours: age, stale: false };
  };
  // pass 1 for staging deployment (other staging checks are BLOCKED without it), then everything in order, runs before suites
  const dep = sorted.find((c) => c.kind === "staging_deployed");
  const stagingDeployed = dep ? evalOne(dep, false).status === "PASS" : false;
  for (const c of sorted.filter((x) => x.kind !== "suite")) results.set(c.id, evalOne(c, stagingDeployed));
  for (const c of sorted.filter((x) => x.kind === "suite")) results.set(c.id, evalOne(c, stagingDeployed));
  return sorted.map((c) => results.get(c.id)!);
}

// ---- owner actions, findings, gates ----------------------------------------------------------------------------------
export type ActionResult = OwnerAction & { status: Status | "CLOSED"; closed_at: string | null; closed_by: string | null; closure_evidence_ids: string[]; reason: string };
export function evaluateActions(actions: OwnerAction[], events: ActionEvent[], results: Result[], evidence: Evidence[]): ActionResult[] {
  const r = new Map(results.map((x) => [x.id, x])); const ev = new Map(evidence.map((e) => [e.id, e]));
  return [...actions].sort((a, b) => a.id - b.id).map((a) => {
    const last = events.filter((e) => e.action_id === a.id).sort((x, y) => y.id - x.id)[0];
    const checks = a.closes_with.map((id) => r.get(id));
    const allPass = checks.every((c) => c?.status === "PASS");
    const notPass = checks.filter((c) => c?.status !== "PASS").map((c) => `${c?.id || "?"} ${c?.status || "unknown"}`).join("; ");
    const open = (reason: string, ids: string[] = []): ActionResult => ({ ...a, status: "OWNER ACTION REQUIRED", closed_at: null, closed_by: null, closure_evidence_ids: ids, reason });
    if (!last || last.event !== "closed") return open(allPass ? "evidence present — waits for the owner to close it" : notPass);
    if (last.actor_role != null && last.actor_role !== "owner") return open("a closure not made by an owner does not count");
    // the closure must cite PASS evidence of exactly the checks this action names (code evidence of other checks cannot close it)
    const cited = last.evidence_ids.map((id) => ev.get(id));
    if (!cited.length || cited.some((e) => !e || e.status !== "PASS" || !a.closes_with.includes(e.check_id))) return open("the closure cites evidence that does not belong to this action");
    const missing = a.closes_with.filter((cid) => !cited.some((e) => e!.check_id === cid));
    if (missing.length) return open(`the closure has no evidence for ${missing.join(", ")}`);
    if (!allPass) return open(`closed on ${last.at.slice(0, 10)}, but the evidence no longer counts: ${notPass}`, last.evidence_ids);
    return { ...a, status: "CLOSED", closed_at: last.at, closed_by: last.actor, closure_evidence_ids: last.evidence_ids, reason: "closed by the owner with evidence" };
  });
}

/** Current state of every finding (the latest version of each). */
export function currentFindings(rows: Finding[]): Finding[] {
  const m = new Map<string, Finding>();
  for (const f of [...rows].sort((a, b) => a.seq - b.seq)) m.set(f.finding_id, f);
  return [...m.values()].sort((a, b) => a.severity.localeCompare(b.severity) || a.finding_id.localeCompare(b.finding_id));
}

export type Unmet = { type: "check" | "owner_action" | "finding" | "gate"; id: string; name: string; status: string; reason: string };
export type GateResult = { gate: Gate; ready: boolean; unmet: Unmet[] };
const GATE_ORDER: Gate[] = ["development", "staging", "production", "live"];
export function gates(results: Result[], actions: ActionResult[], findings: Finding[], settings: Partial<Settings> = {}): Record<Gate, GateResult> {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const open = findings.filter((f) => f.state === "open");
  const need = (g: Gate) => results.filter((r) => r.gates.includes(g) && (r.mandatory || (r.kind === "pilot" && s.require_pilot)));
  const out = {} as Record<Gate, GateResult>;
  for (const g of GATE_ORDER) {
    const unmet: Unmet[] = need(g).filter((r) => r.status !== "PASS").map((r) => ({ type: "check", id: r.id, name: r.name, status: r.status, reason: r.reason }));
    if (g === "staging" || g === "production") for (const a of actions.filter((x) => (g === "staging" ? x.blocks_staging : x.blocks_production) && x.status !== "CLOSED"))
      unmet.push({ type: "owner_action", id: `OA-${a.id}`, name: a.title, status: String(a.status), reason: a.reason });
    if (g !== "development") {
      for (const f of open.filter((f) => f.severity === "P0")) unmet.push({ type: "finding", id: f.finding_id, name: f.description, status: "open P0", reason: "an open P0 blocks every gate" });
      const reach = (b: string) => b !== "none" && GATE_ORDER.indexOf(b as Gate) <= GATE_ORDER.indexOf(g);
      for (const f of open.filter((f) => f.severity === "P1" && (reach(f.blocking_gate) || g === "production" || g === "live"))) unmet.push({ type: "finding", id: f.finding_id, name: f.description, status: "open P1", reason: g === "staging" ? "blocks staging" : "an open blocking P1 blocks production" });
      for (const f of open.filter((f) => f.severity !== "P0" && f.severity !== "P1" && reach(f.blocking_gate))) unmet.push({ type: "finding", id: f.finding_id, name: f.description, status: `open ${f.severity}`, reason: `blocks ${f.blocking_gate}` });
    }
    // every gate builds on the one before it
    const prev = GATE_ORDER[GATE_ORDER.indexOf(g) - 1];
    if (prev && g !== "staging" && !out[prev].ready) unmet.unshift({ type: "gate", id: prev.toUpperCase(), name: `${prev === "production" ? "PRODUCTION READY" : prev.toUpperCase() + " READY"}`, status: "NO", reason: `${g === "live" ? "PRODUCTION LIVE" : "PRODUCTION READY"} requires it` });
    if (g === "staging" && !out.development.ready) unmet.unshift({ type: "gate", id: "DEVELOPMENT", name: "DEVELOPMENT ACCEPTED", status: "NO", reason: "STAGING READY requires it" });
    out[g] = { gate: g, ready: unmet.length === 0, unmet };
  }
  return out;
}

// ---- views: backup ladder, MFA, registration, production touch ----------------------------------------------------------
export type Rung = { step: string; ok: boolean | null; detail: string };
export function backupLadder(live: Live, results: Result[], s: Settings = DEFAULT_SETTINGS, now = Date.now()): { rungs: Rung[]; real_backup: boolean } {
  const st = live.backup?.state || null; const at = st?.at ? Date.parse(st.at) : NaN;
  const restore = results.find((r) => r.kind === "restore_drill" && r.envs.includes(live.environment || "") && r.mandatory);
  const rungs: Rung[] = [
    { step: "1. Backup code exists", ok: true, detail: "this build contains the backup job (format 5, every table)" },
    { step: "2. Backup configuration exists", ok: live.integrations ? !!live.integrations.backup_passphrase : null, detail: live.integrations ? (live.integrations.backup_passphrase ? "encryption passphrase configured" : "BACKUP_PASSPHRASE not configured — the job refuses to write") : "not known here" },
    { step: "3. Backup job is enabled", ok: live.integrations ? !!live.integrations.backup_passphrase && !!live.backup?.last_job : null, detail: live.backup?.last_job ? `last attempt ${live.backup.last_job.started_at} (${live.backup.last_job.status})` : "the scheduler has not run the backup job" },
    { step: "4. Backup actually ran", ok: !!live.backup?.last_success, detail: live.backup?.last_success ? `last success ${live.backup.last_success}` : "never completed" },
    { step: "5. Backup artifact exists", ok: !!st?.name, detail: st?.name ? `${st.name} (${st.bytes} bytes)` : "no artifact" },
    { step: "6. Artifact integrity verified", ok: st?.verified === true, detail: st?.verified ? "read back, decrypted and hash-checked" : "not verified" },
    { step: "7. Off-project copy exists", ok: st?.offsite === true, detail: st?.offsite ? `store: ${st.target}` : "no copy outside the project" },
    { step: "8. Backup is recent enough", ok: Number.isFinite(at) ? (now - at) / H <= s.operational_hours : false, detail: Number.isFinite(at) ? `${Math.round((now - at) / H)} h old (limit ${s.operational_hours} h)` : "no backup" },
    { step: "9. Restore has been tested", ok: restore ? restore.status === "PASS" : false, detail: restore ? `${restore.id}: ${restore.status}` : "no hosted restore drill for this environment" },
  ];
  return { rungs, real_backup: !!st?.name && st?.verified === true };
}

/** Production touch log of the current cycle, from the change log and the latest production probe. */
export function productionTouch(changes: { at: string; environment: string; category: string; what: string; actor?: string | null; reference?: string | null; source?: string }[], probe: Result | undefined, cycleStart: string) {
  const cats = ["code_deploy", "db_migration", "config", "secret_rotation", "role_change", "policy_approval", "backup", "integration"] as const;
  const prod = changes.filter((c) => c.environment === "production" && c.at >= cycleStart);
  const by = Object.fromEntries(cats.map((k) => [k, prod.filter((c) => c.category === k)]));
  const probeOk = probe?.evidence && probe.evidence.metrics?.touched === false && !probe.stale;
  const touched = prod.length > 0 ? true : probe?.evidence?.metrics?.touched === true ? true : probeOk ? false : null;
  return { cycle_start: cycleStart, touched, categories: by, probe: probe?.evidence ? { at: probe.evidence.completed_at, source_ref: probe.evidence.source_ref, metrics: probe.evidence.metrics, stale: probe.stale } : null,
    statement: touched === false ? "PRODUCTION WAS NOT TOUCHED — supported by the change log and the production probe" : touched ? "PRODUCTION WAS CHANGED in this cycle (see categories)" : "no production probe evidence — the statement cannot be supported" };
}

// ---- secrets guard for every export ------------------------------------------------------------------------------------
const SECRET_KEY = /(secret|password|passphrase|token|api[_-]?key|service[_-]?role|private[_-]?key|connection[_-]?string|db[_-]?url|smtp[_-]?pass)/i;
const SECRET_VALUE = /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|sk-ant-[A-Za-z0-9_-]+|postgres(ql)?:\/\/[^\s"']+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
/** Removes values of secret-looking keys and secret-looking strings anywhere in a structure (before export or recording). */
export function scrub<T>(v: T): T {
  const walk = (x: any, k = ""): any => {
    if (x == null) return x;
    if (typeof x === "string") return SECRET_VALUE.test(x) ? "[removed]" : x;
    if (Array.isArray(x)) return x.map((y) => walk(y));
    // a secret-named key loses its text value; flags, counts and structures under it (e.g. "secret_rotation": [...]) are walked
    if (typeof x === "object") return Object.fromEntries(Object.entries(x).map(([kk, vv]) => [kk, SECRET_KEY.test(kk) && typeof vv === "string" ? "[removed]" : walk(vv, kk)]));
    return x;
  };
  return walk(v);
}
/** true when a text still contains something that looks like a secret (the export test uses it). */
export const containsSecret = (text: string, values: string[] = []) => SECRET_VALUE.test(text) || values.filter((v) => v && v.length >= 8).some((v) => text.includes(v));
