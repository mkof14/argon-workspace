// The acceptance package (P9-R2 R2-23/R2-24): agron-acceptance.json (structured evidence) and agron-acceptance.md
// (the concise text for an acceptance review). Built only from recorded evidence and the live system state through
// the deterministic engine in acceptance.ts — no AI, no hand-written claims, no secrets, no raw logs.
import {
  type ActionEvent, type Check, type Evidence, type Finding, type Identity, type Live, type OwnerAction, type Result, type Settings,
  DEFAULT_SETTINGS, backupLadder, currentFindings, evaluate, evaluateActions, gates, productionTouch, scrub, shortSha,
} from "./acceptance";

export const PACKAGE_VERSION = "1.0";
export type Change = { id?: number; at: string; environment: string; category: string; what: string; actor?: string | null; reference?: string | null; source?: string };
export type PackageInput = {
  identity: Identity & { schema_fingerprint?: string | null }; checks: Check[]; evidence: Evidence[]; live: Live; actions: OwnerAction[]; events: ActionEvent[];
  findings: Finding[]; changes: Change[]; comments?: { target: string; body: string; at: string }[]; settings?: Partial<Settings>; cycle?: { name: string; started_at: string; production_baseline?: string };
  now?: number;
};

const age = (h: number | null) => (h == null ? "—" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
const brief = (r?: Result) => (r ? { check: r.id, status: r.status, counts: r.counts, reason: r.reason, verified_at: r.verified_at, age: age(r.age_hours), stale: r.stale, environment: r.evidence?.environment || null,
  evidence_ref: r.evidence?.source_ref || null, evidence_id: r.evidence?.id || null, source: r.evidence?.source || null } : null);

export function buildPackage(inp: PackageInput) {
  const now = inp.now ?? Date.now(); const s: Settings = { ...DEFAULT_SETTINGS, ...(inp.settings || {}) };
  const results = evaluate({ checks: inp.checks, evidence: inp.evidence, identity: inp.identity, live: inp.live, settings: s, now });
  const R = (id: string) => results.find((r) => r.id === id);
  const actions = evaluateActions(inp.actions, inp.events, results, inp.evidence);
  const findings = currentFindings(inp.findings);
  const open = findings.filter((f) => f.state === "open");
  const g = gates(results, actions, findings, s);
  const counts = { P0: open.filter((f) => f.severity === "P0").length, P1: open.filter((f) => f.severity === "P1").length, P2: open.filter((f) => f.severity === "P2").length, P3: open.filter((f) => f.severity === "P3").length };
  const cycle = inp.cycle || { name: "current", started_at: "1970-01-01T00:00:00Z" };
  const touch = productionTouch(inp.changes, R("P9.PROD.TOUCH"), cycle.started_at);
  const ladder = backupLadder(inp.live, results, s, now);
  const runs = inp.evidence.filter((e) => ["P9.REG.FULL", "P9.UNIT"].includes(e.check_id) || inp.checks.find((c) => c.id === e.check_id)?.kind === "regression").sort((a, b) => b.seq - a.seq)
    .map((e) => ({ run_id: e.source_ref, check: e.check_id, class: e.metrics?.mode === "full_clean" ? "FULL CLEAN REGRESSION" : e.metrics?.mode === "isolated_rerun" ? "ISOLATED RERUN" : e.check_id === "P9.UNIT" ? "UNIT RUN" : "PARTIAL TEST",
      scope: e.metrics?.scope || [], sha: e.git_sha, environment: e.environment, db_version: e.db_version, started: e.started_at, finished: e.completed_at, duration_s: e.metrics?.duration_s ?? null,
      suites: e.metrics?.suite_count ?? (e.metrics?.suites ? Object.keys(e.metrics.suites).length : null), tests: e.metrics?.tests ?? null, passed: e.metrics?.passed ?? null, failed: e.metrics?.failed ?? null,
      skipped: e.metrics?.skipped ?? null, reruns: e.metrics?.reruns ?? null, env_recreated: e.metrics?.env_recreated ?? null, result: e.status, counts_for_this_release: R(e.check_id)?.evidence?.id === e.id && R(e.check_id)?.counts === true }));
  const a = inp.live.access || {};
  const pol = (inp.live.policies || []).filter((p) => p.active);
  const mfaLive = (id: string) => { const r = R(id); return { ...brief(r), steps: r?.evidence?.metrics?.steps || null }; };
  const prodProbe = R("P9.PROD.TOUCH")?.evidence?.metrics || null;
  const json = scrub({
    package: { name: "agron-acceptance", version: PACKAGE_VERSION, generated_at: new Date(now).toISOString(), source_environment: inp.identity.environment, release_sha: inp.identity.git_sha },
    identity: { ...inp.identity, migration_set: `v2–v${inp.identity.db_version} (sha256 ${inp.identity.migration_hash?.slice(0, 16) || "unknown"})` },
    readiness: { development_accepted: g.development.ready, staging_ready: g.staging.ready, production_ready: g.production.ready, production_live: g.live.ready },
    gates: g,
    findings: { counts, open: open.map((f) => ({ id: f.finding_id, severity: f.severity, description: f.description, state: f.state, owner: f.owner, blocking_gate: f.blocking_gate })),
      closed: findings.filter((f) => f.state !== "open").map((f) => ({ id: f.finding_id, severity: f.severity, state: f.state })) },
    regression: { gate: brief(R("P9.REG.FULL")), unit: brief(R("P9.UNIT")), register: runs },
    security: [
      ["dependency audit", "P9.AUDIT"], ["production build", "P9.BUILD"], ["TypeScript", "P9.TYPECHECK"], ["RLS suite", "P9.SEC.RLS"], ["restricted-data leakage suite", "P9.SEC.RESTRICTED"],
      ["staging security suite (direct known ID, aggregate leakage, file access, export authorisation)", "P9.SEC.STAGING"], ["environment isolation", "P9.SEC.ENV"],
      ["preview → production isolation (live)", "P9.ENV.PREVIEW"], ["public sign-up — staging", "P9.SIGNUP.STAGING"], ["public sign-up — production", "P9.SIGNUP.PRODUCTION"],
      ["MFA live — staging", "P9.MFA.LIVE.STAGING"], ["MFA live — production", "P9.MFA.LIVE.PRODUCTION"], ["capability separation", "P9.SEC.CAPS"],
    ].map(([item, id]) => ({ item, ...brief(R(id)), details: id === "P9.SEC.STAGING" ? R(id)?.evidence?.metrics?.groups || null : undefined })),
    backup: { environment: inp.identity.environment, real_backup_here: ladder.real_backup, ladder: ladder.rungs, production: brief(R("P9.BACKUP.PRODUCTION")), staging: brief(R("P9.BACKUP.STAGING")),
      production_real_backup: R("P9.BACKUP.PRODUCTION")?.status === "PASS" },
    restore: { hosted: { ...brief(R("P9.RESTORE.STAGING")), metrics: R("P9.RESTORE.STAGING")?.evidence?.metrics || null }, local: { ...brief(R("P9.RESTORE.LOCAL")), metrics: R("P9.RESTORE.LOCAL")?.evidence?.metrics || null } },
    mfa: { supported_by_code: true, required_here: !!a.mfa_required, requiring_here: a.requiring_mfa ?? null, enrolled_here: a.privileged_with_mfa ?? null, live_staging: mfaLive("P9.MFA.LIVE.STAGING"), live_production: mfaLive("P9.MFA.LIVE.PRODUCTION"),
      coverage_production: brief(R("P9.MFA.COVERAGE.PRODUCTION")), live_verified: R("P9.MFA.LIVE.STAGING")?.status === "PASS" && R("P9.MFA.LIVE.PRODUCTION")?.status === "PASS" },
    registration: { application_rejects_uninvited: brief(R("P9.REG.APP")), signup_staging: brief(R("P9.SIGNUP.STAGING")), signup_production: brief(R("P9.SIGNUP.PRODUCTION")),
      note: "the application mitigation does not equal PUBLIC SIGNUP CLOSED" },
    policies: { environment: inp.identity.environment, total: pol.length, approved: pol.filter((p) => p.status === "Approved").length, owner_approved: pol.filter((p) => p.owner_approved).length,
      pending: pol.filter((p) => p.status !== "Approved").map((p) => p.code), threshold_currency: [...new Set(pol.map((p) => p.currency || "not specified"))],
      ready_for_owner_approval: pol.filter((p) => p.status !== "Approved" && p.ready_for_approval === true).length,
      model_version: [...new Set(pol.map((p) => (p.model_version != null ? String(p.model_version) : "not specified")))],
      // separation of duty, from the live capability state and the recorded capability-separation check
      separation_of_duty: { conflicts: a.conflicts || [], self_approved: pol.filter((p) => p.self_approved === true).map((p) => p.code), check: brief(R("P9.SEC.CAPS")) },
      policy_approvers: a.authorities?.policy_approvers ?? null, list: pol.map((p) => ({ code: p.code, version: p.version, status: p.status, seeded_default: p.seeded, owner_approved: p.owner_approved,
        approved_by: p.approved_by, approved_at: p.approved_at, currency: p.currency || "not specified", chain: p.chain, model_version: p.model_version ?? null, ready_for_approval: p.ready_for_approval ?? null,
        label: p.status === "Approved" ? "APPROVED" : p.ready_for_approval ? "READY FOR OWNER APPROVAL" : "UNAPPROVED DEFAULT CONFIGURATION" })),
      gate: brief(R("P9.POLICIES.PRODUCTION")) },
    access: { environment: inp.identity.environment, ...a, matrix: brief(R("P9.ACCESS.PRODUCTION")) },
    staging: { deployed: brief(R("P9.STAGING.DEPLOYED")), personas: brief(R("P9.PERSONAS.STAGING")), security: brief(R("P9.SEC.STAGING")), performance: brief(R("P9.PERF.STAGING")),
      endurance: brief(R("P9.ENDURANCE")), real_users: brief(R("P9.USERS")), real_devices: brief(R("P9.DEVICES")) },
    performance: { gate: brief(R("P9.PERF.STAGING")), local_runs: inp.evidence.filter((e) => e.check_id === "P9.PERF.STAGING" && e.metrics?.tier === "local").slice(0, 3).map((e) => ({ at: e.completed_at, sha: shortSha(e.git_sha), label: "LOCAL PERFORMANCE — not production-grade evidence" })),
      metrics: R("P9.PERF.STAGING")?.evidence?.metrics || null },
    endurance: { gate: brief(R("P9.ENDURANCE")), tool_checks: inp.evidence.filter((e) => e.check_id === "P9.ENDURANCE" && Number(e.metrics?.minutes) < 1440).slice(0, 3).map((e) => ({ at: e.completed_at, minutes: e.metrics?.minutes, label: "TOOL CHECK — NOT ACCEPTANCE EVIDENCE" })),
      metrics: R("P9.ENDURANCE")?.evidence?.metrics || null },
    real_users: { ...brief(R("P9.USERS")), summary: R("P9.USERS")?.evidence?.metrics || null },
    real_devices: { ...brief(R("P9.DEVICES")), summary: R("P9.DEVICES")?.evidence?.metrics || null },
    migration: { synthetic: { ...brief(R("P9.MIGRATION.SYNTHETIC")), metrics: R("P9.MIGRATION.SYNTHETIC")?.evidence?.metrics || null }, production_copy: { ...brief(R("P9.MIGRATION.PRODCOPY")), metrics: R("P9.MIGRATION.PRODCOPY")?.evidence?.metrics || null },
      data_compatibility: R("P9.MIGRATION.PRODCOPY")?.status === "PASS" ? "proven on a protected production copy" : "NOT PROVEN — only a protected production-copy rehearsal proves it" },
    production: { current: prodProbe ? { app_version: prodProbe.app_version ?? null, sha: prodProbe.sha ?? null, db_version: prodProbe.db_version ?? null, deployment: prodProbe.deployment_id ?? null, deployed_at: prodProbe.deployment_created_at ?? null, health: prodProbe.health ?? null } : null,
      touch, security_patch: prodProbe?.security_patch ?? null, backup: R("P9.BACKUP.PRODUCTION")?.status === "PASS" ? "REAL BACKUP: YES" : "REAL BACKUP: NO" },
    owner_actions: { open: actions.filter((x) => x.status !== "CLOSED"), closed: actions.filter((x) => x.status === "CLOSED") },
    checks: results.map((r) => ({ id: r.id, phase: r.phase, name: r.name, kind: r.kind, mandatory: r.mandatory, gates: r.gates, freshness: r.freshness, envs: r.envs, status: r.status, counts: r.counts, reason: r.reason,
      verified_at: r.verified_at, age: age(r.age_hours), stale: r.stale, history: r.history, superseded: r.superseded, evidence: r.evidence ? { id: r.evidence.id, environment: r.evidence.environment, sha: r.evidence.git_sha, app_version: r.evidence.app_version,
        db_version: r.evidence.db_version, started_at: r.evidence.started_at, completed_at: r.evidence.completed_at, source: r.evidence.source, source_ref: r.evidence.source_ref, recorded_via: r.evidence.recorded_via, summary: r.evidence.summary } : null })),
    changes: inp.changes.filter((c) => c.at >= cycle.started_at).slice(0, 200),
    comments: (inp.comments || []).slice(0, 50),
    settings: s, cycle,
    integrity: { generated_at: new Date(now).toISOString(), source_environment: inp.identity.environment, release_sha: inp.identity.git_sha, package_version: PACKAGE_VERSION,
      evidence_rows: inp.evidence.length, evidence_last_seq: inp.evidence.reduce((m, e) => Math.max(m, e.seq), 0), computed_by: "src/lib/acceptance.ts (deterministic, no AI)" },
  });
  return { json, md: renderMarkdown(json), results, gates: g, actions };
}

const yn = (b: boolean | null | undefined) => (b === true ? "YES" : b === false ? "NO" : "UNKNOWN");
const st = (x: any) => (x ? `${x.status}${x.reason ? ` — ${x.reason}` : ""}${x.verified_at ? ` (verified ${x.verified_at.slice(0, 16).replace("T", " ")} UTC, age ${x.age}${x.stale ? ", STALE" : ""})` : ""}` : "NOT RUN");
const cell = (v: any) => String(v ?? "—").replace(/\|/g, "/").replace(/\n/g, " ");

/** R2-24: the Markdown for an acceptance review — concise, exactly the 15 sections. */
export function renderMarkdown(p: any): string {
  const L: string[] = [];
  const h = (t: string) => L.push("", `## ${t}`, "");
  const li = (k: string, v: any) => L.push(`- **${k}:** ${v}`);
  L.push("# AGRON WORKSPACE — ACCEPTANCE PACKAGE", "", `Generated ${p.package.generated_at} from **${p.package.source_environment}** · package ${p.package.version} · computed deterministically from recorded evidence (no AI).`);
  h("1. Release Identity");
  li("Environment", p.identity.environment); li("App version", p.identity.app_version); li("Git SHA", `\`${p.identity.git_sha || "unknown"}\`${p.identity.dirty ? " (UNCOMMITTED CHANGES)" : ""}`);
  li("DB version", `v${p.identity.db_version ?? "?"}`); li("Migration set", p.identity.migration_set);
  h("2. Current Readiness");
  li("Development Accepted", yn(p.readiness.development_accepted)); li("Staging Ready", yn(p.readiness.staging_ready)); li("Production Ready", yn(p.readiness.production_ready)); li("Production Live", yn(p.readiness.production_live));
  h("3. Open Findings");
  if (!p.findings.open.length) L.push("None open.");
  else { L.push("| ID | Severity | Description | State | Owner | Blocking gate |", "|---|---|---|---|---|---|"); for (const f of p.findings.open) L.push(`| ${cell(f.id)} | ${f.severity} | ${cell(f.description)} | ${f.state} | ${cell(f.owner)} | ${f.blocking_gate} |`); }
  h("4. Full Regression");
  const reg = p.regression.register.find((r: any) => r.counts_for_this_release && r.check === "P9.REG.FULL") || p.regression.register.find((r: any) => r.check === "P9.REG.FULL");
  li("Gate", st(p.regression.gate));
  if (reg) { li("Run ID", `\`${reg.run_id}\``); li("Scope", (reg.scope || []).join(", ") || "—"); li("Clean/full", `${reg.class}${reg.env_recreated ? ", environment recreated" : ""}`);
    li("Passed / Failed / Skipped", `${reg.passed} / ${reg.failed} / ${reg.skipped} of ${reg.tests} (${reg.suites} suites)`); li("Reruns", reg.reruns); li("Duration", reg.duration_s != null ? `${Math.floor(reg.duration_s / 60)} min ${reg.duration_s % 60} s` : "—");
    li("SHA", `\`${reg.sha}\``); li("Environment", reg.environment); }
  else li("Run", "none recorded");
  li("Unit tests", st(p.regression.unit));
  const others = p.regression.register.filter((r: any) => r !== reg).slice(0, 5);
  if (others.length) { L.push("", "Other runs (newest first):", "", "| Run | Class | SHA | Env | Passed/Tests | Result |", "|---|---|---|---|---|---|"); for (const r of others) L.push(`| ${cell(r.run_id)} | ${r.class} | ${cell(r.sha?.slice(0, 12))} | ${r.environment} | ${r.passed ?? "—"}/${r.tests ?? "—"} | ${r.result}${r.counts_for_this_release ? "" : " (does not count for this release)"} |`); }
  h("5. Security");
  L.push("| Check | Status | Evidence |", "|---|---|---|"); for (const x of p.security) L.push(`| ${cell(x.item)} | ${x.status} | ${cell(x.reason)}${x.evidence_ref ? ` — ${cell(x.evidence_ref)}` : ""} |`);
  h("6. Backup / Restore");
  li("Actual backup exists (production)", p.backup.production_real_backup ? "YES" : "NO"); li(`Actual backup exists (${p.backup.environment})`, p.backup.real_backup_here ? "YES" : "NO");
  const rung = (n: number) => p.backup.ladder[n - 1];
  li("Last backup", rung(5).ok ? `${rung(5).detail}; ${rung(8).detail}` : "none"); li("Off-project copy", rung(7).ok ? "YES" : "NO"); li("Integrity", rung(6).ok ? "verified" : "not verified");
  li("Production backup check", st(p.backup.production));
  li("Restore tested (hosted)", st(p.restore.hosted)); li("Restore drill (local, informational)", st(p.restore.local));
  const rm = p.restore.hosted.metrics || p.restore.local.metrics;
  if (rm) { li("Restore duration", rm.duration_ms != null ? `${rm.duration_ms} ms` : "—"); li("Trigger/constraint/function/RLS verification", rm.post_verify ? `triggers ${yn(rm.post_verify.triggers_ok)}, constraints ${yn(rm.post_verify.constraints_ok)}, functions ${yn(rm.post_verify.functions_ok)}, RLS ${yn(rm.post_verify.rls_ok)}` : "NOT PERFORMED"); }
  L.push("", "Backup ladder (this environment): " + p.backup.ladder.map((r: any) => `${r.step.split(".")[0]}=${r.ok === true ? "yes" : r.ok === false ? "no" : "?"}`).join(", "));
  h("7. Policies");
  li("Approved / total", `${p.policies.approved} / ${p.policies.total} (owner-approved ${p.policies.owner_approved}) in ${p.policies.environment}`); li("Pending policies", p.policies.pending.join(", ") || "none");
  li("Threshold currency", p.policies.threshold_currency.join(", ")); li("Policy approver status", p.policies.policy_approvers != null ? `${p.policies.policy_approvers} Policy Approver(s) besides owners` : "unknown"); li("Production gate", st(p.policies.gate));
  li("Policy model version", p.policies.model_version.join(", ")); li("Ready for owner approval", `${p.policies.ready_for_owner_approval} / ${p.policies.total}`);
  const sod = p.policies.separation_of_duty;
  li("Separation of duty", `${sod.conflicts.length ? sod.conflicts.map((c: any) => `${c.rule}: ${c.accounts}`).join("; ") : "no conflicting capability holders"}; self-approved policies: ${sod.self_approved.join(", ") || "none"}; capability-separation check: ${st(sod.check)}`);
  L.push("", "| Policy | Version | Model | Status | Currency | Approval chain (tier: steps) |", "|---|---|---|---|---|---|");
  for (const x of p.policies.list) L.push(`| ${x.code} | ${x.version} | ${x.model_version ?? "—"} | ${x.label} | ${x.currency} | ${(x.chain || []).map((t: any) => `${t.tier}: ${(t.steps || []).join(t.mode === "parallel" ? " + " : " → ")}`).join("; ").replace(/\|/g, "/") || "—"} |`);
  h("8. Users / Access");
  li("Access matrix complete", st(p.access.matrix)); li(`MFA coverage (${p.access.environment})`, `${p.access.privileged_with_mfa ?? "?"} of ${p.access.requiring_mfa ?? "?"} owners/administrators enrolled; required: ${yn(p.access.mfa_required)}`);
  li("Unresolved conflicts", (p.access.conflicts || []).length ? p.access.conflicts.map((c: any) => `${c.rule}: ${c.accounts}`).join("; ") : "none"); li("Accounts", `${p.access.active ?? "?"} active, ${p.access.disabled ?? "?"} disabled, ${p.access.owners ?? "?"} owners, ${p.access.admins ?? "?"} admins, ${p.access.controlled_data_users ?? "?"} controlled-data users`);
  h("9. Staging");
  li("Deployed", st(p.staging.deployed)); li("Security test", st(p.staging.security)); li("Performance", st(p.staging.performance)); li("Endurance", st(p.staging.endurance)); li("Real users", st(p.staging.real_users)); li("Real devices", st(p.staging.real_devices));
  h("10. Migration");
  li("Synthetic rehearsal", st(p.migration.synthetic)); li("Production-copy rehearsal", st(p.migration.production_copy));
  li("Rollback", p.migration.production_copy.metrics?.rollback_ok === true ? "proven on production copy" : p.migration.synthetic.metrics?.rollback_ok === true ? "proven on synthetic data only" : "not proven");
  li("Data compatibility", p.migration.data_compatibility);
  h("11. Production");
  const c = p.production.current;
  li("Current version", c?.app_version ?? "unknown (no probe)"); li("Current SHA", c?.sha ? `\`${c.sha}\`` : "unknown"); li("Current DB version", c?.db_version != null ? `v${c.db_version}` : "unknown");
  li("Production touched during this cycle?", `${yn(p.production.touch.touched)} — ${p.production.touch.statement}${p.production.touch.probe ? ` (probe ${p.production.touch.probe.at})` : ""}`);
  li("Backup", p.production.backup); li("Security patch status", p.production.security_patch ?? "unknown");
  h("12. Owner Actions");
  if (!p.owner_actions.open.length) L.push("None open.");
  else { L.push("| # | Category | Action | Blocks staging | Blocks production | Closes with | State |", "|---|---|---|---|---|---|---|"); for (const x of p.owner_actions.open) L.push(`| ${x.id} | ${x.category} | ${cell(x.title)} | ${x.blocks_staging ? "yes" : "no"} | ${x.blocks_production ? "yes" : "no"} | ${cell(x.closure_evidence)} | ${cell(x.reason)} |`); }
  h("13. Blocking Gates");
  for (const [k, label] of [["staging", "STAGING READY"], ["production", "PRODUCTION READY"], ["live", "PRODUCTION LIVE"]] as const) {
    const gg = p.gates[k]; L.push(`**${label}: ${gg.ready ? "YES" : "NO"}**${gg.ready ? "" : ` — ${gg.unmet.length} unmet:`}`);
    for (const u of gg.unmet) L.push(`- ${u.type === "check" ? u.id : u.type === "owner_action" ? u.id : u.type === "finding" ? `finding ${u.id}` : u.id}: ${u.status} — ${cell(u.type === "check" ? u.reason : u.name)}`);
    L.push("");
  }
  h("14. Final Machine Verdict");
  li("P0 count", p.findings.counts.P0); li("P1 count", p.findings.counts.P1); li("STAGING READY", yn(p.readiness.staging_ready)); li("PRODUCTION READY", yn(p.readiness.production_ready)); li("PRODUCTION LIVE", yn(p.readiness.production_live));
  h("15. Evidence Integrity");
  li("generated_at", p.integrity.generated_at); li("source environment", p.integrity.source_environment); li("release SHA", `\`${p.integrity.release_sha || "unknown"}\``); li("evidence package version", p.integrity.package_version);
  li("evidence rows", `${p.integrity.evidence_rows} (append-only; last seq ${p.integrity.evidence_last_seq})`); li("computed by", p.integrity.computed_by);
  return L.join("\n") + "\n";
}
