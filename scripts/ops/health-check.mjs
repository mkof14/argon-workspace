// P9-R1 R22 — operations alerting from the authorised health answer (v2.42+). Exits 1 with one line per problem, so a
// failed GitHub Actions run e-mails the repository owner. Needs only HEALTH_URL and CRON_SECRET (no other secret).
//   HEALTH_URL=https://workspace.agron1.com/api/health CRON_SECRET=… node scripts/ops/health-check.mjs
const url = process.env.HEALTH_URL, secret = process.env.CRON_SECRET;
if (!url || !secret) { console.log("HEALTH_URL / CRON_SECRET not set — operations check skipped"); process.exit(0); }
const r = await fetch(url, { headers: { authorization: `Bearer ${secret}` } }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));
const h = await r.json().catch(() => ({}));
const problems = [];
const P = (sev, what) => problems.push(`${sev}: ${what}`);
if (!r.ok || !h.ok) P("CRITICAL", `application, database or sign-in unhealthy (HTTP ${r.status}) ${JSON.stringify(h.checks || {})}`);
if (!h.release) { if (r.ok) P("HIGH", "the health answer has no release section (old version, or the secret was refused)"); }
else {
  if (!h.release.db_matches) P("CRITICAL", `database version ${h.release.db} differs from the build (${h.release.db_expected})`);
  if (h.storage && !h.storage.ok) P("HIGH", "file storage does not answer");
  const stale = Object.entries(h.scheduler || {}).filter(([k, j]) => k !== "error" && !j.fresh).map(([k]) => k);
  if (stale.length) P("HIGH", `jobs without a recent successful run: ${stale.join(", ")}`);
  const o = h.operations || {};
  if ((o.jobs_dead || 0) > 0) P("HIGH", `${o.jobs_dead} dead-lettered job run(s) in 7 days`);
  if ((o.jobs_failed_24h || 0) >= 3) P("HIGH", `${o.jobs_failed_24h} failed job runs in 24 h`);
  const dead = (o.automation_queue || {}).dead || 0; if (dead > 0) P("MEDIUM", `${dead} automation action(s) dead-lettered`);
  const out = o.outbound || {}; if ((out.failed || 0) + (out.uncertain || 0) > 0) P("MEDIUM", `${out.failed || 0} failed and ${out.uncertain || 0} uncertain outbound e-mail(s)`);
  if ((o.notifications_pending || 0) > 500) P("MEDIUM", `${o.notifications_pending} notifications waiting for delivery`);
  if ((o.errors_24h || 0) > 20) P("MEDIUM", `${o.errors_24h} application errors in 24 h`);
  if ((o.auth_failures_24h || 0) > 10) P("HIGH", `${o.auth_failures_24h} refused uninvited sign-ins in 24 h`);
  const backupOn = h.integrations?.backup_passphrase && h.integrations?.backup_offsite;
  if (!backupOn) P("CRITICAL", "no encrypted off-site backup is configured");
  else if (!o.backup?.at || Date.now() - Date.parse(o.backup.at) > 26 * 3600e3 || o.backup.verified === false) P("CRITICAL", `the last verified backup is older than 26 h (${o.backup?.at || "none"})`);
}
for (const p of problems) console.log(`::error::${p}`);
console.log(problems.length ? `${problems.length} problem(s)` : "operations: all checks passed");
process.exit(problems.some((p) => /^(CRITICAL|HIGH)/.test(p)) ? 1 : 0);
