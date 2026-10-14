import { marked } from "marked";
import { checkSystems } from "./systems";
import { scan, type Check } from "./domainscan";
import { sendMail } from "./mailer";
import { listBackups, readState, runBackup, saveState } from "./backup";
import { renderEmail, SITE } from "@/lib/mail";
import { departmentReport } from "@/lib/reports";
import { prevMonth, thisMonth } from "@/lib/channels";
import { DEPARTMENTS } from "@/config/workspace.config.mjs";
import { withDefaults } from "@/lib/automation";
const roles = async (db: any) => withDefaults(await readState(db, "settings").catch(() => null)).notify;

/** Scheduled company jobs: weekly backup, daily monitoring with alerts, monthly department reports. */
const people = async (db: any, roles: string[]) => ((await db.from("profiles").select("email,full_name,role,lang").in("role", roles)).data || []).filter((p: any) => p.email);
const page = (subject: string, html: string) => renderEmail({ subject, heading: subject, body: "", html, lang: "en", sender: null });

/* ---------- Backup ---------- */
export async function backupJob(db: any) {
  const r = await runBackup(db);
  const to = await people(db, ["owner"]);
  const small = r.encrypted && r.bytes < 18 * 1024 * 1024;
  const html = `<p style="font-size:16px;line-height:1.6;color:#2A3440">Weekly backup saved: <b>${r.name.split("/").pop()}</b> (${(r.bytes / 1024).toFixed(0)} KB) — ${r.counts.records} records, ${r.counts.comments} comments, ${r.counts.profiles} people.</p>
<p style="font-size:15px;line-height:1.6;color:#2A3440">${r.encrypted ? (small ? "The encrypted copy is attached. Keep it on your computer or drive; open it in Workspace → Administration → System → Backup with the backup password." : "The file is larger than an email allows; download it from Workspace → Administration → System → Backup.") : "<b>The copy is stored in Workspace but not encrypted, so it is not emailed.</b> Add BACKUP_PASSPHRASE in Vercel to receive an encrypted copy every week."}</p>
<p style="font-size:14px;color:#7A8796">Files (PDF, images) stay in storage; make a full local copy with files from the same System page.</p>`;
  const subject = `AGRON Workspace backup ${new Date().toISOString().slice(0, 10)}`;
  for (const p of to) await sendMail({ to: p.email, subject, html: page(subject, html), text: `Weekly backup saved: ${r.name}. ${r.counts.records} records.`, attachments: small ? [{ filename: r.name.split("/").pop()!, content: r.body, contentType: "application/octet-stream" }] : undefined });
  await saveState(db, "backup", { at: new Date().toISOString(), name: r.name, bytes: r.bytes, encrypted: r.encrypted, counts: r.counts, emailed: small ? to.length : 0 });
  return { name: r.name, bytes: r.bytes, encrypted: r.encrypted, counts: r.counts };
}

/* ---------- Monitoring ---------- */
export const DOMAINS = ["agron1.com", "stardome.life", "workspace.agron1.com"];
type Problem = { what: string; detail: string; level: "fail" | "warn" };
export async function monitorJob(db: any, opts: { alwaysEmail?: boolean } = {}) {
  const systems = await checkSystems(db);
  const scans = await Promise.all(DOMAINS.map(scan));
  const problems: Problem[] = [];
  for (const s of systems as any[]) if (!s.skipped && s.status !== "Operational") problems.push({ what: s.title, detail: `${s.status} — ${s.last_check}${s.ms ? ` (${s.ms} ms)` : ""}`, level: s.status === "Down" ? "fail" : "warn" });
  const important = new Set(["tls", "spf", "dmarc", "http"]);
  for (const d of scans) for (const c of d.checks as Check[]) if (c.status === "fail" && important.has(c.id) || (c.id === "tls" && c.status !== "pass")) problems.push({ what: `${d.domain}: ${c.label}`, detail: c.detail, level: c.status === "fail" ? "fail" : "warn" });
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
    for (const p of to) { if (!(await sendMail({ to: p.email, subject, html: page(subject, html), text: problems.map((x) => `- ${x.what}: ${x.detail}`).join("\n") || "All systems OK" }))) emailed++; }
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
  let sent = 0; for (const x of to) if (!(await sendMail({ to: x.email, subject, html: page(subject, html), text: md }))) sent++;
  await saveState(db, "reports", { at: new Date().toISOString(), period: p, sent, departments: depts.length });
  return { period: p, sent, departments: depts.length };
}

export async function opsStatus(db: any) {
  const [backup, monitor, reports, files] = await Promise.all([readState(db, "backup").catch(() => null), readState(db, "monitor").catch(() => null), readState(db, "reports").catch(() => null), listBackups(db).catch(() => [])]);
  return { backup, monitor, reports, backups: files, passphrase: !!process.env.BACKUP_PASSPHRASE, csl: !!process.env.CSL_API_KEY, youtube: !!process.env.YOUTUBE_API_KEY };
}
