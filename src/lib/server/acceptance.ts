// Server side of the Acceptance Evidence Center (P9-R2): loads the evidence store, the live system state and the
// release identity, records system snapshots (machine evidence from authoritative state), and builds the package.
import { APP_ENV, MIGRATION_HASH, RELEASE_DIRTY, RELEASE_SHA_FULL, SUPABASE_ANON, SUPABASE_URL, evidenceEnv } from "../env";
import { APP_VERSION, DB_VERSION } from "../version";
import { DEFAULT_SETTINGS, type Evidence, type Identity, type Live, scrub } from "../acceptance";
import { buildPackage } from "../acceptance-package";

export async function dbVersion(db: any): Promise<number | null> {
  try { const { data } = await db.rpc("workspace_db_version"); return typeof data === "number" ? data : null; } catch { return null; }
}
export async function releaseIdentity(db: any): Promise<Identity & { schema_fingerprint?: string | null }> {
  return { environment: evidenceEnv(), app_version: APP_VERSION, git_sha: RELEASE_SHA_FULL, db_version: await dbVersion(db), migration_hash: MIGRATION_HASH, dirty: RELEASE_DIRTY };
}

/** The environment name of this database is set by the server whose settings env.ts verified. */
async function bindEnvironment(db: any) {
  const name = evidenceEnv();
  const { data } = await db.from("acceptance_settings").select("value").eq("key", "environment").maybeSingle();
  if (data?.value?.name === name) return;
  await db.from("acceptance_settings").upsert({ key: "environment", value: { name, bound_at: new Date().toISOString() } });
  await db.from("acceptance_env_changes").insert({ environment: name, category: "config", what: `acceptance store bound to environment ${name}${data?.value?.name ? ` (was ${data.value.name})` : ""}`, source: "system" });
}

/** Public sign-up state of this project, from its sign-in service (the public settings answer, no key needed beyond anon). */
async function signupState(): Promise<Live["signup"]> {
  const at = new Date().toISOString();
  if (!SUPABASE_URL || !SUPABASE_ANON) return { disable_signup: null, at, error: "no database" };
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const j: any = await r.json();
    return { disable_signup: typeof j.disable_signup === "boolean" ? j.disable_signup : null, at };
  } catch { return { disable_signup: null, at, error: "sign-in service did not answer" }; }
}
const integrations = () => ({
  email: !!process.env.SMTP_PASS, ai: !!process.env.ANTHROPIC_API_KEY, calendar: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  backup_offsite: !!(process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_KEY_ID), backup_passphrase: !!process.env.BACKUP_PASSPHRASE, cron_secret: !!process.env.CRON_SECRET,
});

export async function liveState(db: any): Promise<Live> {
  const { data, error } = await db.rpc("acceptance_live");
  if (error) throw new Error(`acceptance state not readable: ${error.message}`);
  return { ...(data as any), signup: await signupState(), integrations: integrations() };
}

export async function loadStore(db: any) {
  const [checks, evidence, actions, events, findings, changes, comments, settings] = await Promise.all([
    db.from("acceptance_checks").select("*").order("sort"),
    db.from("acceptance_evidence").select("*").order("seq", { ascending: false }).limit(5000),
    db.from("acceptance_owner_actions").select("*").order("id"),
    db.from("acceptance_owner_action_events").select("*").order("id"),
    db.from("acceptance_findings").select("*").order("seq"),
    db.from("acceptance_env_changes").select("*").order("id", { ascending: false }).limit(500),
    db.from("acceptance_comments").select("target,body,at,author").order("id", { ascending: false }).limit(100),
    db.from("acceptance_settings").select("key,value"),
  ]);
  for (const r of [checks, evidence, actions, events, findings, changes, comments, settings]) if (r.error) throw new Error(`acceptance store not readable: ${r.error.message}`);
  const actorIds = [...new Set((events.data || []).map((e: any) => e.actor))];
  const roles = new Map<string, string>();
  if (actorIds.length) { const { data } = await db.from("profiles").select("id,role").in("id", actorIds); for (const p of data || []) roles.set(p.id, p.role); }
  const set = Object.fromEntries((settings.data || []).map((x: any) => [x.key, x.value]));
  return {
    checks: checks.data || [], evidence: (evidence.data || []) as Evidence[], actions: actions.data || [],
    events: (events.data || []).map((e: any) => ({ ...e, actor_role: roles.get(e.actor) || null })), findings: findings.data || [], changes: changes.data || [], comments: comments.data || [],
    settings: { ...DEFAULT_SETTINGS, ...(set.freshness || {}), ...(set.gates || {}), label: set.freshness?.label || DEFAULT_SETTINGS.label }, cycle: set.cycle || undefined,
  };
}

const rec = async (db: any, row: Record<string, any>) => { const { data, error } = await db.rpc("acceptance_record", { p: scrub(row) }); if (error) throw new Error(error.message); return data as string; };

/**
 * Machine evidence from authoritative system state of this environment, recorded when the package is produced
 * (and by the daily job): sign-up state, policies, MFA coverage, staging deployment health, the latest backup.
 * Each snapshot is one append-only row; nothing here is decided by a person or an AI.
 */
export async function recordSnapshot(db: any, live?: Live) {
  await bindEnvironment(db);
  const id = await releaseIdentity(db); const L = live || (await liveState(db)); const env = id.environment; const at = new Date().toISOString();
  const base = { environment: env, app_version: id.app_version, git_sha: id.git_sha, db_version: id.db_version, migration_hash: id.migration_hash, started_at: at, completed_at: at, source: "system state", recorded_via: "system" };
  const out: string[] = [];
  const envKey = env === "production" ? "PRODUCTION" : env === "staging" ? "STAGING" : null;
  if (envKey && L.signup?.disable_signup != null) out.push(await rec(db, { ...base, check_id: `P9.SIGNUP.${envKey}`, status: L.signup.disable_signup ? "PASS" : "OWNER ACTION REQUIRED", source_ref: `auth settings ${L.signup.at}`,
    summary: L.signup.disable_signup ? "public sign-up disabled" : "public sign-up ENABLED", metrics: { disable_signup: L.signup.disable_signup, probed_at: L.signup.at } }));
  if (env === "production" && L.policies) {
    const act = L.policies.filter((p) => p.active); const approved = act.filter((p) => p.status === "Approved").length;
    out.push(await rec(db, { ...base, check_id: "P9.POLICIES.PRODUCTION", status: approved === act.length && act.length ? "PASS" : "OWNER ACTION REQUIRED", source_ref: `policies ${at}`, summary: `${approved}/${act.length} approved`,
      metrics: { total: act.length, approved, owner_approved: act.filter((p) => p.owner_approved).length, pending: act.filter((p) => p.status !== "Approved").map((p) => p.code) } }));
    const a = L.access || {}; const m = { mfa_required: !!a.mfa_required, requiring: a.requiring_mfa ?? 0, enrolled: a.privileged_with_mfa ?? null };
    out.push(await rec(db, { ...base, check_id: "P9.MFA.COVERAGE.PRODUCTION", status: m.mfa_required && m.requiring > 0 && m.enrolled === m.requiring ? "PASS" : "OWNER ACTION REQUIRED", source_ref: `access ${at}`, summary: `${m.enrolled ?? "?"}/${m.requiring} enrolled`, metrics: m }));
  }
  if (env === "staging") out.push(await rec(db, { ...base, check_id: "P9.STAGING.DEPLOYED", status: id.db_version === DB_VERSION ? "PASS" : "FAIL", source_ref: `staging app ${id.git_sha.slice(0, 12)} ${at}`,
    summary: id.db_version === DB_VERSION ? "staging app answers with its own database at the expected version" : `database v${id.db_version}, build expects v${DB_VERSION}`, blocker: id.db_version === DB_VERSION ? null : "database version mismatch",
    metrics: { health_status: 200, database: true, db_version: id.db_version, app_env: APP_ENV } }));
  // configuration changes seen since the last snapshot (names and yes/no only — never a value)
  const { data: seen0 } = await db.from("acceptance_settings").select("value").eq("key", "observed").maybeSingle();
  const prev = seen0?.value || null; const nowSeen = { integrations: L.integrations || {}, disable_signup: L.signup?.disable_signup ?? null };
  if (prev) {
    const cat = (k: string) => (k.startsWith("backup") ? "backup" : k === "cron_secret" ? "scheduler" : "integration");
    for (const [k, v] of Object.entries(nowSeen.integrations)) if (prev.integrations?.[k] !== undefined && prev.integrations[k] !== v)
      await db.from("acceptance_env_changes").insert({ environment: env, category: cat(k), what: `${k} ${v ? "configured" : "removed"}`, source: "system" });
    if (prev.disable_signup != null && nowSeen.disable_signup != null && prev.disable_signup !== nowSeen.disable_signup)
      await db.from("acceptance_env_changes").insert({ environment: env, category: "signup", what: nowSeen.disable_signup ? "public sign-up disabled" : "public sign-up enabled", source: "system" });
  }
  await db.from("acceptance_settings").upsert({ key: "observed", value: { ...nowSeen, at } });
  // a code deployment of a new release is an environment change
  if (env === "staging" || env === "production") {
    const { data: seen } = await db.from("acceptance_env_changes").select("id").eq("category", "code_deploy").eq("environment", env).eq("reference", id.git_sha).limit(1);
    if (!seen?.length) await db.from("acceptance_env_changes").insert({ environment: env, category: env === "staging" ? "staging_deploy" : "code_deploy", what: `release ${id.app_version} (${id.git_sha.slice(0, 12)}) running`, reference: id.git_sha, source: "system" });
  }
  return out;
}

/** Evidence of a finished backup job (called by the job itself): artifact, size, integrity, off-project. */
export async function recordBackup(db: any, r: { name: string; bytes: number; verified: boolean; offsite: boolean; ms?: number; counts?: any }) {
  const env = evidenceEnv(); const envKey = env === "production" ? "PRODUCTION" : env === "staging" ? "STAGING" : null;
  if (!envKey) return null;
  const id = await releaseIdentity(db); const at = new Date().toISOString();
  return rec(db, { check_id: `P9.BACKUP.${envKey}`, status: r.verified && (envKey !== "PRODUCTION" || r.offsite) ? "PASS" : "FAIL", environment: env, app_version: id.app_version, git_sha: id.git_sha, db_version: id.db_version,
    migration_hash: id.migration_hash, started_at: at, completed_at: at, source: "backup job", source_ref: r.name, recorded_via: "system",
    summary: `${r.name}: ${r.bytes} bytes, ${r.verified ? "integrity verified" : "NOT verified"}, ${r.offsite ? "off-project" : "inside the project"}`,
    blocker: r.verified ? (envKey === "PRODUCTION" && !r.offsite ? "the copy is not outside the project" : null) : "integrity check failed",
    metrics: { artifact: r.name, bytes: r.bytes, integrity_verified: r.verified, offsite: r.offsite, ms: r.ms ?? null, tables: r.counts ? Object.keys(r.counts).length : null } });
}

export async function acceptancePackage(db: any) {
  const [store, identity, live] = await Promise.all([loadStore(db), releaseIdentity(db), liveState(db)]);
  return buildPackage({ ...store, identity, live, now: Date.now() } as any);
}
