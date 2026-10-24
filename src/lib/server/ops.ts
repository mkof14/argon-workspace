import { marked } from "marked";
import { checkSystems } from "./systems";
import { scan, type Check } from "./domainscan";
import { sendMail } from "./mailer";
import { localizeMail } from "./translate";
import { listBackups, runBackup, backupStore, BackupConfigError } from "./backup";
import { readState, saveState } from "./state";
import { jobHealth } from "./jobs";
import { alertAdmins } from "./alerts";
import { reportError } from "./errors";
import { s3Config } from "./s3";
import { recordBackup, recordSnapshot } from "./acceptance";
import { renderEmail, SITE } from "@/lib/mail";
import { departmentReport } from "@/lib/reports";
import { prevMonth, thisMonth } from "@/lib/channels";
import { DEPARTMENTS } from "@/config/workspace.config.mjs";
import { withDefaults } from "@/lib/automation";
const roles = async (db: any) => withDefaults(await readState(db, "settings").catch(() => null)).notify;

/** Scheduled company jobs: weekly backup, daily monitoring with alerts, monthly department reports. */
const people = async (db: any, roles: string[]) => ((await db.from("profiles").select("email,full_name,role,lang").in("role", roles)).data || []).filter((p: any) => p.email);
const page = (subject: string, html: string, lang: any = "en") => renderEmail({ subject, heading: subject, body: "", html, lang, sender: null });
/** Sends a system e-mail in the reader's language (Settings → translation of e-mails). */
async function mailTo(db: any, p: { email: string; lang?: string }, m: { subject: string; html: string; text: string }, attachments?: any[]) {
  const on = withDefaults(await readState(db, "settings").catch(() => null)).translate.emails;
  const x = on ? await localizeMail(db, p.lang, m) : m;
  return sendMail({ to: p.email, subject: x.subject, html: page(x.subject, x.html, on && p.lang ? p.lang : "en"), text: x.text, attachments });
}

/* ---------- Backup ---------- */
/** Daily encrypted backup (data + files) to the backup store; administrators are told when it fails. */
export async function backupJob(db: any, o: { deadline?: number } = {}) {
  try {
    const r: any = await runBackup(db, { deadline: o.deadline });
    if (r.partial) return r; // continues on the next run
    // acceptance evidence (P9-R2): the job itself records the artifact it produced — never inferred from a plan
    await recordBackup(db, r).catch(() => null);
    return r;
  } catch (e: any) {
    await alertAdmins(db, { key: `backup-failed|${new Date().toISOString().slice(0, 10)}`, subject: "AGRON Workspace: the backup failed", lines: [String(e?.message || e), e instanceof BackupConfigError ? "Nothing was written. Set the missing setting and the next run makes the backup." : "The scheduler tries again with increasing pauses."] }).catch(() => 0);
    throw e;
  }
}

/* ---------- Monitoring ---------- */
export const DOMAINS = ["agron1.com", "stardome.life", "workspace.agron1.com"];
type Problem = { what: string; detail: string; level: "fail" | "warn" };
export async function monitorJob(db: any, opts: { alwaysEmail?: boolean } = {}) {
  // acceptance evidence (P9-R2): the daily snapshot of authoritative state (sign-up, policies, MFA, deployment)
  await recordSnapshot(db).catch(() => null);
  const systems = await checkSystems(db);
  const scans = await Promise.all(DOMAINS.map(scan));
  const problems: Problem[] = [];
  for (const s of systems as any[]) if (!s.skipped && s.status !== "Operational") problems.push({ what: s.title, detail: `${s.status} — ${s.last_check}${s.ms ? ` (${s.ms} ms)` : ""}`, level: s.status === "Down" ? "fail" : "warn" });
  const important = new Set(["tls", "spf", "dmarc", "http"]);
  for (const d of scans) for (const c of d.checks as Check[]) if (c.status === "fail" && important.has(c.id) || (c.id === "tls" && c.status !== "pass")) problems.push({ what: `${d.domain}: ${c.label}`, detail: c.detail, level: c.status === "fail" ? "fail" : "warn" });
  // Workspace itself: scheduled jobs, dead-lettered actions, uncertain e-mail deliveries, backup age
  const ops = await operationsChecks(db).catch((e) => { reportError(db, "monitor:ops", e); return [] as Problem[]; });
  problems.push(...ops);
  const prev = await readState(db, "monitor").catch(() => null);
  const key = problems.map((p) => p.what + p.level).sort().join("|");
  const changed = (prev?.key || "") !== key;
  const state = { at: new Date().toISOString(), key, systems: (systems as any[]).map((s) => ({ title: s.title, status: s.status, ms: s.ms ?? null, skipped: !!s.skipped })), domains: scans.map((d) => ({ domain: d.domain, ok: d.checks.filter((c) => c.status === "pass").length, total: d.checks.length, issues: d.checks.filter((c) => c.status !== "pass").map((c) => `${c.label}: ${c.detail}`) })), problems };
  await saveState(db, "monitor", state);
  let emailed = 0;
  // Alert when something is wrong and the picture changed since yesterday (no daily repeats), or when asked
  if ((problems.length && changed) || opts.alwaysEmail) {
    const to = await people(db, (await roles(db)).monitor_roles);
    const subject = problems.length ? `AGRON monitoring: ${problems.length} issue${problems.length > 1 ? "s" : ""}` : "AGRON monitoring: all systems OK";
    const list = problems.length ? `<ul style="padding-left:18px;font-size:15px;line-height:1.6;color:#2A3440">${problems.map((p) => `<li><b style="color:${p.level === "fail" ? "#B4232F" : "#A15C00"}">${esc(p.what)}</b> — ${esc(p.detail)}</li>`).join("")}</ul>` : `<p style="font-size:16px;color:#1F7A4D">All monitored systems and domains are fine.</p>`;
    const html = `${list}<p style="font-size:14px;color:#7A8796">Checked ${(systems as any[]).filter((s) => !s.skipped).length} systems and ${scans.length} domains. Details: <a href="${SITE}/technical/overview">Technical</a> · <a href="${SITE}/security/overview">Security</a>.</p>`;
    for (const p of to) { if (!(await mailTo(db, p, { subject, html, text: problems.map((x) => `- ${x.what}: ${x.detail}`).join("\n") || "All systems OK" }))) emailed++; }
  }
  return { problems: problems.length, emailed, changed };
}

/* ---------- Monthly reports ---------- */
const tableStyle = (h: string) => h.replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 14px">').replace(/<th>/g, '<th style="border:1px solid #D5DCE4;background:#F5F7F9;padding:5px 7px;text-align:left">').replace(/<td>/g, '<td style="border:1px solid #D5DCE4;padding:5px 7px">')
  .replace(/<h1>/g, '<h2 style="font-size:20px;color:#0E141A;margin:26px 0 6px;border-top:1px solid #E3E8EE;padding-top:18px">').replace(/<\/h1>/g, "</h2>").replace(/<h2>/g, '<h3 style="font-size:16px;color:#0E141A;margin:16px 0 6px">').replace(/<\/h2>/g, "</h3>")
  .replace(/<p>/g, '<p style="font-size:14px;line-height:1.55;color:#2A3440;margin:4px 0">').replace(/<li>/g, '<li style="font-size:14px;line-height:1.55;color:#2A3440">');
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function reportsJob(db: any, period?: string) {
  const p = period || prevMonth(thisMonth());
  // Not export-controlled records only: the email may be read on any device
  const recs: any[] = []; for (let from = 0; ; from += 1000) { const { data } = await db.from("records").select("id,section,title,status,data,controlled,created_at,updated_at").eq("controlled", false).range(from, from + 999); recs.push(...(data || [])); if (!data || data.length < 1000) break; }
  const depts = (DEPARTMENTS as any[]).map((d) => d.key).filter((k) => !["mail", "company"].includes(k));
  const md = depts.map((d) => departmentReport(d, recs, [p])).join("\n\n");
  const html = `<p style="font-size:15px;line-height:1.6;color:#2A3440">Department reports for <b>${p}</b>, built from Workspace records (export-controlled records are not included in email). Open any department overview → Report for AI conclusions and PDF.</p>${tableStyle(await marked.parse(md))}`;
  const subject = `AGRON monthly report — ${p}`;
  const to = await people(db, (await roles(db)).report_roles);
  let sent = 0; for (const x of to) if (!(await mailTo(db, x, { subject, html, text: md }))) sent++;
  await saveState(db, "reports", { at: new Date().toISOString(), period: p, sent, departments: depts.length });
  return { period: p, sent, departments: depts.length };
}

/** Checks of Workspace's own operations, also used by the status screen. */
export async function operationsChecks(db: any): Promise<Problem[]> {
  const out: Problem[] = []; const now = Date.now();
  const h = await jobHealth(db);
  for (const m of h.missed) out.push({ what: `Scheduled job missed: ${m.label}`, detail: m.last ? `last finished ${m.last.slice(0, 16).replace("T", " ")} UTC` : "never finished", level: "fail" });
  for (const j of h.jobs) for (const d of j.dead) out.push({ what: `Job stopped trying: ${j.label}`, detail: `${d.slot || ""} — ${d.error || ""}`.slice(0, 300), level: "fail" });
  const [{ count: dead }, { count: unc }] = await Promise.all([
    db.from("automation_queue").select("id", { count: "exact", head: true }).eq("status", "dead"),
    db.from("outbound_messages").select("id", { count: "exact", head: true }).eq("status", "uncertain"),
  ]);
  if (dead) out.push({ what: "Automatic actions that gave up", detail: `${dead} item(s) — Operations → Retry or close`, level: "fail" });
  if (unc) out.push({ what: "E-mail deliveries to check", detail: `${unc} message(s) may or may not have arrived — Operations → mark each one`, level: "warn" });
  const b = await readState(db, "backup").catch(() => null);
  if (!process.env.BACKUP_PASSPHRASE) out.push({ what: "Backups are off", detail: "BACKUP_PASSPHRASE is not set — no backup is written without encryption", level: "fail" });
  else if (!b || now - Date.parse(b.at) > 30 * 3600e3) out.push({ what: "No recent backup", detail: b ? `last ${String(b.at).slice(0, 16).replace("T", " ")} UTC` : "no backup yet", level: "fail" });
  if (process.env.BACKUP_PASSPHRASE && !s3Config()) out.push({ what: "Backups are not off-site", detail: "copies stay in the same Supabase project until the S3-compatible store is set (BACKUP_S3_*)", level: "warn" });
  return out;
}

/** Housekeeping with the daily recycle-bin job: old counters, keys, runs and logs leave the database. */
export async function housekeeping(db: any) {
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
  const res: Record<string, any> = {};
  const del = async (t: string, col: string, before: string, extra?: (q: any) => any) => { let q = db.from(t).delete({ count: "exact" }).lt(col, before); if (extra) q = extra(q); const { count, error } = await q; if (error) throw new Error(`${t}: ${error.message}`); res[t] = count || 0; };
  await del("rate_limits", "window_start", d(2));
  await del("automation_fired", "fired_on", d(60).slice(0, 10), (q) => q.not("key", "like", "digest|%"));
  await del("automation_fired", "fired_on", d(3).slice(0, 10), (q) => q.like("key", "digest|%"));
  await del("job_runs", "started_at", d(90), (q) => q.neq("status", "running"));
  await del("automation_log", "at", d(180));
  return res;
}

export async function opsStatus(db: any) {
  const [backup, monitor, reports, files, drill] = await Promise.all([readState(db, "backup").catch(() => null), readState(db, "monitor").catch(() => null), readState(db, "reports").catch(() => null), listBackups(db).catch(() => []), readState(db, "restore-drill").catch(() => null)]);
  return { backup, monitor, reports, backups: files, drill, passphrase: !!process.env.BACKUP_PASSPHRASE, offsite: !!s3Config(), target: backupStore(db).kind, csl: !!process.env.CSL_API_KEY, youtube: !!process.env.YOUTUBE_API_KEY };
}
