import { buildClosed, buildDelivered } from "../builds";
import { weakVendors } from "@/lib/vendors";
import { clientLang, dunningLetter, stepFor } from "@/lib/dunning";
import Anthropic from "@anthropic-ai/sdk";
import { readState, saveState, claimKeys } from "./state";
import { sendExternal } from "./outbound";
import { patchRecord, step, type Op } from "./records";
import { reportError, guarded } from "./errors";
import { alertAdmins } from "./alerts";
import { sendMail } from "./mailer";
import { localizeMail } from "./translate";
import { PUSH, pushTo } from "./push";
import { renderEmail, SITE } from "@/lib/mail";
import { fileRecord, readInbox } from "./mailIntake";
import { draftEmail } from "./drafts";
import { allSections } from "@/config/workspace.config.mjs";
import { REFS } from "@/config/links";
import { nextOccurrence } from "@/lib/recur";
import { cashForecast } from "@/lib/cashforecast";
import { milestoneReady } from "@/lib/milestones";
import { serviceDone } from "@/lib/service";
import { poStamps } from "@/lib/vendors";
import { changeOrderEffects, projectMoney } from "@/lib/margin";
import { slaFor } from "@/lib/sla";
import { shortages } from "@/lib/parts";
import { dueItems, isMine, money, PEOPLE_KEYS } from "@/lib/insights";
import { dealEmail, financeFindings, hrFindings, legalFindings, marketingFindings, securityFindings, technicalFindings, operationsFindings, salesFindings, type Finding } from "@/lib/deptAgents";
import { AGENTS, DEPT_AGENTS, DEFAULT_RULES, aiCost, dateDue, isWorkday, matchEvent, qualityIssues, render, withDefaults, type Action, type AgentId, type Ev, type Rule, type Settings } from "@/lib/automation";

/**
 * Automation engine: company settings, "when → then" rules and agents.
 * State lives in database tables (v18): settings, rules, the approval/execution queue, the agent log and
 * "already done" keys. Every proposal is claimed atomically, so it runs once even when two people approve it
 * at the same moment or two workers pick it up; e-mail to outside addresses has its own delivery record.
 * Safety: changes from an agent in "suggest" mode, and every email to an outside address, wait in the approval queue.
 * Records marked "US persons only" are announced only to US persons. Every action is written to the agent log and the activity history.
 */
const SECS: any[] = allSections() as any[];
const label = (id: string) => SECS.find((s) => s.id === id)?.label?.en || id;
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const recUrl = (r: { id: string; section: string }) => `${SITE}/${r.section.replace(".", "/")}?r=${r.id}`;
const isUuid = (x: any) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x);

export type LogEntry = { at: string; agent: AgentId | "system"; kind: "run" | "action" | "queued" | "error" | "decision"; text: string; record?: string; section?: string };
/** status: pending (waits for a person) · processing · approved (done) · rejected · failed — state gives the exact execution stage. */
export type QueueItem = { id: string; at: string; agent: AgentId; title: string; detail: string; record_id?: string; section?: string; action: Action; status: "pending" | "approved" | "rejected" | "failed" | "processing"; state?: string; attempts?: number; next_attempt_at?: string | null; last_error?: string | null; decided_by?: string; decided_at?: string; result?: string; controlled?: boolean };
type Row = { id: string; created_at: string; agent: AgentId; title: string; detail: string | null; record_id: string | null; section: string | null; action: Action; controlled: boolean; dedupe_key: string | null; status: string; decided_by: string | null; decided_at: string | null; exec_id: string | null; attempts: number; max_attempts: number; next_attempt_at: string | null; result: string | null; last_error: string | null };
const LEGACY: Record<string, QueueItem["status"]> = { pending: "pending", rejected: "rejected", processing: "processing", retrying: "processing", completed: "approved", failed: "failed", dead: "failed" };
export const toItem = (r: Row): QueueItem => ({ id: r.id, at: r.created_at, agent: r.agent, title: r.title, detail: r.detail || "", record_id: r.record_id || undefined, section: r.section || undefined, action: r.action, status: LEGACY[r.status] || "failed", state: r.status, attempts: r.attempts, next_attempt_at: r.next_attempt_at, last_error: r.last_error, decided_by: r.decided_by || undefined, decided_at: r.decided_at || undefined, result: r.result || undefined, controlled: r.controlled });

/* ---------------- State ---------------- */
let legacyChecked = false;
/** Once: moves state kept by the earlier version (JSON files in Storage) into the tables. Never overwrites table rows. */
export async function migrateLegacy(db: any) {
  if (legacyChecked) return; 
  const { data: mark } = await db.from("ops_state").select("key").eq("key", "legacy_import").maybeSingle();
  if (mark) { legacyChecked = true; return; }
  const file = async (k: string) => { try { const { data } = await db.storage.from("backups").download(`state/${k}.json`); return data ? JSON.parse(await data.text()) : null; } catch { return null; } };
  const [settings, rules, queue, log, fired] = await Promise.all(["settings", "rules", "queue", "agentlog", "fired"].map(file));
  const done: Record<string, number> = {};
  if (settings) { const { data: has } = await db.from("automation_settings").select("id").maybeSingle(); if (!has) { await db.from("automation_settings").insert({ id: true, value: withDefaults(settings) }); done.settings = 1; } }
  if (Array.isArray(rules)) { const { count } = await db.from("automation_rules").select("id", { count: "exact", head: true }); if (!count) { await db.rpc("automation_save_rules", { p_rules: rules.slice(0, 200), p_by: "migration" }); done.rules = rules.length; } }
  if (Array.isArray(queue) && queue.length) {
    const st: Record<string, string> = { pending: "pending", approved: "completed", rejected: "rejected", failed: "failed" };
    const rows = queue.slice(0, 600).map((q: any) => ({ id: isUuid(q.id) ? q.id : undefined, created_at: q.at, agent: q.agent, title: q.title, detail: q.detail || null, record_id: isUuid(q.record_id) ? q.record_id : null, section: q.section || null, action: q.action, controlled: !!q.controlled, status: st[q.status] || "failed", decided_by: q.decided_by || null, decided_at: q.decided_at || null, result: q.result || null, dedupe_key: q.status === "pending" || q.status === "rejected" ? `${q.record_id}|${q.title}` : null }));
    const { error } = await db.from("automation_queue").upsert(rows, { onConflict: "id", ignoreDuplicates: true }); if (!error) done.queue = rows.length;
  }
  if (Array.isArray(log) && log.length) { await db.from("automation_log").insert(log.slice(0, 500).map((l: any) => ({ at: l.at, agent: l.agent, kind: l.kind, text: String(l.text || "").slice(0, 2000), record_id: isUuid(l.record) ? l.record : null, section: l.section || null }))); done.log = Math.min(500, log.length); }
  if (fired && typeof fired === "object") {
    const rows = Object.entries(fired).filter(([, d]) => /^\d{4}-\d{2}-\d{2}/.test(String(d))).map(([key, d]) => ({ key, fired_on: String(d).slice(0, 10) }));
    for (let i = 0; i < rows.length; i += 500) await db.from("automation_fired").upsert(rows.slice(i, i + 500), { onConflict: "key", ignoreDuplicates: true });
    done.fired = rows.length;
  }
  await db.from("ops_state").upsert({ key: "legacy_import", value: { at: new Date().toISOString(), ...done } }, { onConflict: "key" });
  legacyChecked = true;
}
export async function getSettings(db: any): Promise<Settings> {
  const { data } = await db.from("automation_settings").select("value").eq("id", true).maybeSingle();
  return withDefaults(data ? data.value : await readState(db, "settings").catch(() => null));
}
export async function saveSettings(db: any, s: any, by?: string) {
  const { error } = await db.from("automation_settings").upsert({ id: true, value: withDefaults(s), updated_at: new Date().toISOString(), updated_by: by || null }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
export async function getRules(db: any): Promise<Rule[]> {
  const { data } = await db.from("automation_rules").select("rule").order("position");
  if (data?.length) return data.map((x: any) => x.rule);
  const { data: saved } = await db.from("ops_state").select("key").eq("key", "rules_saved").maybeSingle();
  if (saved) return []; // the owner removed every rule
  const r = await readState(db, "rules").catch(() => null); return Array.isArray(r) ? r : DEFAULT_RULES;
}
export async function saveRules(db: any, rules: Rule[], by?: string) {
  const { error } = await db.rpc("automation_save_rules", { p_rules: rules.slice(0, 200), p_by: by || null });
  if (error) throw new Error(error.message);
}
export async function getLog(db: any): Promise<LogEntry[]> {
  const { data } = await db.from("automation_log").select("at,agent,kind,text,record_id,section").order("at", { ascending: false }).limit(500);
  return (data || []).map((l: any) => ({ at: l.at, agent: l.agent, kind: l.kind, text: l.text, record: l.record_id || undefined, section: l.section || undefined }));
}
export async function getQueue(db: any, opts: { status?: string[]; limit?: number } = {}): Promise<QueueItem[]> {
  let q = db.from("automation_queue").select("*").order("created_at", { ascending: false }).limit(opts.limit || 600);
  if (opts.status) q = q.in("status", opts.status);
  const { data } = await q; return (data || []).map(toItem);
}
async function addLog(db: any, items: LogEntry[]) {
  if (!items.length) return;
  const { error } = await db.from("automation_log").insert(items.map((l) => ({ at: l.at, agent: l.agent, kind: l.kind, text: String(l.text).slice(0, 2000), record_id: isUuid(l.record) ? l.record : null, section: l.section || null })));
  if (error) await reportError(db, "automation:log", error);
}
type NewItem = { agent: AgentId; title: string; detail: string; record_id?: string; section?: string; action: Action; controlled?: boolean; dedupe_key: string };
async function addQueue(db: any, items: NewItem[]) {
  if (!items.length) return 0;
  const { data, error } = await db.rpc("automation_enqueue", { p_items: items.map((x) => ({ ...x, record_id: isUuid(x.record_id) ? x.record_id : null })) });
  if (error) { await reportError(db, "automation:enqueue", error); return 0; }
  return (data || []).length;
}

/* ---------------- Context ---------------- */
type P = { id: string; email: string; full_name: string; role: string; us_person: boolean; lang?: string };
type Ctx = { db: any; settings: Settings; profiles: P[]; access: { section: string; role: string }[]; log: LogEntry[]; queue: NewItem[]; mail: Map<string, { p: P; lines: string[] }>; known: Set<string> };
async function context(db: any): Promise<Ctx> {
  await migrateLegacy(db).catch((e) => reportError(db, "automation:migrate", e));
  const [settings, { data: profiles }, { data: access }, { data: waiting }] = await Promise.all([getSettings(db), db.from("profiles").select("id,email,full_name,role,lang,us_person,disabled"), db.from("section_access").select("section,role"),
    db.from("automation_queue").select("dedupe_key").in("status", ["pending", "rejected"]).not("dedupe_key", "is", null).limit(5000)]);
  // Proposals already waiting or rejected are not proposed again (the database enforces it too)
  const known = new Set<string>((waiting || []).map((q: any) => q.dedupe_key));
  return { db, settings, profiles: (profiles || []).filter((p: P & { disabled?: boolean }) => p.email && p.role !== "pending" && !p.disabled), access: access || [], log: [], queue: [], mail: new Map(), known };
}
/** Claims "already done" keys for this run; only claimed ones may act. */
const claim = (c: Ctx, items: { key: string; repeat?: number | null }[]) => claimKeys(c.db, items);
const canRead = (c: Ctx, p: P, section: string) => ["owner", "admin"].includes(p.role) || c.access.some((a) => a.role === p.role && a.section === section);

async function allRecords(db: any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await db.from("records").select("id,section,title,status,data,company,controlled,created_by,created_at,updated_at").neq("section", "mail.outbox").range(from, from + 999); if (error) throw new Error(error.message); out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}

/** People to tell: "owner" = whoever the record names, "role:x" = everyone with that role, "leads" = escalation roles from Settings. Only people who may read the section; US-persons-only records only to US persons. */
function recipients(c: Ctx, to: string, rec: any): P[] {
  let list: P[] = [];
  if (to === "owner") list = c.profiles.filter((p) => isMine(rec, p));
  else if (to === "leads") list = c.profiles.filter((p) => c.settings.notify.escalate_roles.includes(p.role));
  else if (to.startsWith("role:")) list = c.profiles.filter((p) => p.role === to.slice(5));
  if (!list.length && to === "owner") list = c.profiles.filter((p) => c.settings.notify.escalate_roles.includes(p.role)); // nobody named → leaders
  return list.filter((p) => canRead(c, p, rec.section) && (!rec.controlled || p.us_person));
}
/** A person named by text (name or email) in a created record is linked to their account (<key>_id): assignments use accounts, not names. */
function linkPeople(c: Ctx, data: Record<string, any>) {
  for (const k of PEOPLE_KEYS) {
    const v = String(data[k] || "").trim().toLowerCase(); if (!v || data[`${k}_id`]) continue;
    const p = c.profiles.find((x) => !["partner", "vendor", "investor"].includes(x.role) && (x.email?.toLowerCase() === v || (x.full_name || "").toLowerCase() === v));
    if (p) { data[`${k}_id`] = p.id; data[k] = p.full_name || p.email; }
  }
}
function tell(c: Ctx, people: P[], line: string) { for (const p of people) { const e = c.mail.get(p.email) || { p, lines: [] }; if (!e.lines.includes(line)) e.lines.push(line); c.mail.set(p.email, e); } }
/** A system e-mail in the reader's language (English stays as written; other languages are translated and cached). */
async function inLang(c: Ctx, p: P, m: { subject: string; html: string; text: string }) {
  return c.settings.translate?.emails === false ? m : localizeMail(c.db, p.lang, m);
}
async function flushMail(c: Ctx, subject: string) {
  let sent = 0;
  for (const { p, lines } of c.mail.values()) {
    const html = `<p style="font-size:15px;line-height:1.6;color:#2A3440">Hello${p.full_name ? ` ${esc(p.full_name.split(" ")[0])}` : ""}, the Workspace automation has news for you:</p><ul style="padding-left:18px;font-size:15px;line-height:1.6;color:#2A3440">${lines.map((l) => `<li>${l}</li>`).join("")}</ul><p style="font-size:13px;color:#7A8796">Rules and agents: Administration → System → Automation.</p>`;
    const m = await inLang(c, p, { subject, html, text: lines.map((l) => "- " + l.replace(/<[^>]+>/g, "")).join("\n") });
    const err = await sendMail({ to: p.email, subject: m.subject, html: renderEmail({ subject: m.subject, heading: m.subject, body: "", html: m.html, lang: (p.lang as any) || "en", sender: null }), text: m.text });
    if (!err) sent++; else { c.log.push({ at: new Date().toISOString(), agent: "system", kind: "error", text: `Email to ${p.email}: ${err}` }); await reportError(c.db, "automation:mail", err, { detail: `to ${p.email}` }); }
    // A short signal on the phone too (only on devices where the person turned notifications on)
    await pushTo(c.db, [p.id], (l) => ({ title: PUSH.agents_t[l], body: PUSH.agents_b[l].replace("{n}", String(lines.length)), url: "/today", tag: "agents" })).catch(() => 0);
  }
  c.mail.clear(); return sent;
}
async function save(c: Ctx) {
  const items = c.queue.splice(0); const logs = c.log.splice(0);
  await Promise.all([addLog(c.db, logs), addQueue(c.db, items)]);
}
const audit = (c: Ctx, agent: AgentId, rec: { id: string; section: string; title: string }, text: string) => !rec.id ? Promise.resolve() :
  c.db.from("activity").insert({ record_id: rec.id, section: rec.section, actor: null, action: "automation", detail: { agent, title: rec.title, text } }).then(({ error }: any) => error && reportError(c.db, "automation:audit", error), (e: any) => reportError(c.db, "automation:audit", e));

/* ---------------- Actions ---------------- */
function describeAction(a: Action, rec: any) {
  if (a.type === "create") return `Create “${render(a.title, rec, today())}” in ${label(a.section)}${a.status ? ` (${a.status})` : ""}`;
  if (a.type === "set") return `Set ${a.field} of “${rec.title}” to “${a.value}”`;
  if (a.type === "file") return `File email from ${a.from} “${a.subject}” into ${label(a.section)} as “${a.title}”`;
  if (a.type === "email") return `Email ${a.to || rec.data?.[a.to_field] || "(no address)"}: ${render(a.subject, rec)}`;
  return `Notify ${a.to.replace("role:", "")}: ${render(a.message, rec)}`;
}

/** A failure that may pass on a second try (connection, mail server busy). */
export class Retry extends Error { constructor(m: string) { super(m); this.name = "Retry"; } }
/** Runs one action now. Returns a short result text. `idem` makes a repeated execution do nothing the second time. */
async function execute(c: Ctx, agent: AgentId, a: Action, rec: any, o: { idem?: string; queueId?: string } = {}): Promise<string> {
  const db = c.db;
  if (a.type === "notify") {
    const ppl = recipients(c, a.to, rec);
    tell(c, ppl, `${esc(render(a.message, rec))} — <a href="${recUrl(rec)}">open</a>`);
    return `notified ${ppl.length}`;
  }
  if (a.type === "create") {
    if (a.link) { // never create the same linked record twice
      const { data: ex } = await db.from("records").select("id").eq("section", a.section).eq(`data->>${a.link}`, rec.id).limit(1);
      if (ex?.length) return "already exists";
    }
    const data: Record<string, any> = { _by: `agent:${agent}`, _from: rec.id, ...(o.idem ? { _idem: o.idem } : {}) };
    for (const [k, tpl] of Object.entries(a.fields || {})) { const v = render(tpl, rec, today()); if (v) data[k] = /^-?\d+(\.\d+)?$/.test(v) && /amount|value|qty/.test(k) ? Number(v) : v; }
    if (a.link) { data[a.link] = rec.id; data[`${a.link}_title`] = rec.title; }
    linkPeople(c, data);
    const title = render(a.title, rec, today()) || rec.title;
    const { data: made, error } = await db.from("records").insert({ section: a.section, title, status: a.status || null, data, controlled: !!rec.controlled, company: null }).select("id,section,title").single();
    if (error) { if (error.code === "23505" && o.idem) return "already exists"; throw new Error(error.message); }
    await audit(c, agent, made, `Created from “${rec.title}” (${label(rec.section)})`);
    return `created ${made.id}`;
  }
  if (a.type === "set") {
    const done = await patchRecord(db, rec.id, (cur) => (a.field === "status" ? (cur.status === a.value ? null : { status: a.value }) : String(cur.data?.[a.field] ?? "") === String(a.value) ? null : { data: { ...(cur.data || {}), [a.field]: a.value } }));
    if (!done) throw new Error("The record no longer exists");
    await audit(c, agent, rec, `Set ${a.field} to “${a.value}”`);
    return "updated";
  }
  if (a.type === "file") {
    const made = await fileRecord(c.db, a, o.idem);
    await audit(c, agent, made, `Filed from email ${a.from}: ${a.subject}`);
    tell(c, recipients(c, `role:${DEPT_ROLE[a.section.split(".")[0]] || "management"}`, { ...made, data: {}, controlled: a.controlled }), `New from email: ${esc(a.subject)} (${esc(a.from)}) → ${esc(label(a.section))} — <a href="${recUrl(made)}">open</a>`);
    return made.existed ? "already exists" : `created ${made.id}`;
  }
  if (a.type === "email") {
    const to = String(a.to || rec.data?.[a.to_field] || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`No valid email in “${a.to_field}”`);
    const subject = a.to ? a.subject : render(a.subject, rec); const body = a.to ? a.body : render(a.body, rec); // AI drafts are sent exactly as approved
    const out = await sendExternal(db, { idem: o.idem || `adhoc:${agent}:${rec.id}:${subject}`, queueId: o.queueId, to, subject, html: renderEmail({ subject, body, lang: "en", sender: { name: "AGRON Inc.", email: "info@agron1.com" } }), text: body, replyTo: "info@agron1.com" });
    if (out.status === "already-sent") return `already emailed ${to}`;
    if (out.status === "in-progress" || (out.status === "failed" && out.retry)) throw new Retry(out.detail);
    if (out.status !== "sent") throw new Error(out.detail);
    await audit(c, agent, rec, `Emailed ${to}: ${subject}`);
    if (rec.section === "finance.invoices" && rec.id) { // the invoice remembers which reminders went out
      await patchRecord(db, rec.id, (cur) => { const d = cur.data || {}; return { data: { ...d, reminders: [...(Array.isArray(d.reminders) ? d.reminders : []), { at: today(), subject, to }].slice(-10) } }; })
        .catch((e) => reportError(db, "automation:invoice-reminder", e, { detail: rec.id }));
    }
    return `emailed ${to}`;
  }
  return "nothing";
}

/** Executes now or puts into the approval queue, depending on the mode. Notifications to the team always go out. */
async function act(c: Ctx, agent: AgentId, a: Action, rec: any, mode: "auto" | "suggest", why: string, idem?: string, dedupe?: string) {
  const now = new Date().toISOString();
  if (a.type !== "notify" && (mode === "suggest" || a.type === "email")) {
    const k = dedupe || `${rec.id}|${describeAction(a, rec)}`; if (c.known.has(k)) return; c.known.add(k);
    c.queue.push({ agent, title: describeAction(a, rec), detail: why, record_id: rec.id, section: rec.section, action: a, controlled: !!rec.controlled, dedupe_key: k });
    c.log.push({ at: now, agent, kind: "queued", text: describeAction(a, rec), record: rec.id, section: rec.section });
    return;
  }
  try { const res = await execute(c, agent, a, rec, { idem }); if (a.type !== "notify" || res !== "notified 0") c.log.push({ at: now, agent, kind: "action", text: `${describeAction(a, rec)} → ${res}`, record: rec.id, section: rec.section }); }
  catch (e: any) { c.log.push({ at: now, agent, kind: "error", text: `${describeAction(a, rec)}: ${e?.message || e}`, record: rec.id, section: rec.section }); await reportError(c.db, `automation:${agent}`, e, { detail: describeAction(a, rec) }); }
}
const ruleMode = (c: Ctx, r: Rule): "auto" | "suggest" => (c.settings.agents.rules === "auto" ? r.mode : "suggest");

/* ---------------- Events from the app ---------------- */
/** A repeating record was completed: the next occurrence is created once, with the dates moved forward. */
async function repeatNext(db: any, rec: any) {
  const sec: any = (allSections() as any[]).find((s) => s.id === rec.section); if (!sec) return null;
  const n = nextOccurrence(rec, sec.fields, sec.statuses[0]); if (!n) return null;
  const { data: ex } = await db.from("records").select("id").eq("section", rec.section).eq("data->>_prev", rec.id).limit(1);
  if (ex?.length) return null; // already prepared
  const { data, error } = await db.from("records").insert({ section: rec.section, title: n.title, status: n.status, data: { ...n.data, _idem: `repeat:${rec.id}` }, company: rec.company ?? null, controlled: !!rec.controlled, created_by: rec.created_by ?? null }).select("id").single();
  if (error) { if (error.code === "23505") return null; throw new Error(error.message); }
  return data?.id || null;
}

/** Support requests: remember when AGRON first responded and when the request was resolved (for the SLA). Returns new data or null. */
function slaPatch(rec: any, ev: Ev): Record<string, any> | null {
  if (rec.section !== "operations.support" || ev.kind !== "status") return null;
  const now = new Date().toISOString(); const d = { ...(rec.data || {}) }; let ch = false;
  if (!d.responded_at && ev.from === "New" && ev.to !== "New") { d.responded_at = now; ch = true; }
  if (!d.resolved_at && /^(resolved|closed)$/i.test(ev.to || "")) { d.resolved_at = now; if (!d.responded_at) d.responded_at = now; ch = true; }
  if (/^(new|in progress|waiting client)$/i.test(ev.to || "") && d.resolved_at) { delete d.resolved_at; ch = true; } // reopened
  return ch ? d : null;
}

/** Factory or site acceptance closed: the draft invoices waiting for it become ready to send (a person sends them). One transaction. */
async function milestoneStamps(db: any, rec: any, ev: Ev) {
  if (ev.kind !== "status" || !rec.data?.project || !["fat", "sat"].includes(rec.data?.project_step)) return 0;
  let n = 0; let first = "";
  await step(db, async () => {
    const { data: inv } = await db.from("records").select("id,section,status,data,version").eq("section", "finance.invoices").eq("data->>project", rec.data.project).eq("data->>trigger", rec.data.project_step);
    const ch = milestoneReady(rec, inv || [], today()); n = ch.length; first = ch[0]?.id || "";
    return ch.map((x): Op => ({ op: "update", id: x.id, set: { data: x.data }, if_version: (inv || []).find((i: any) => i.id === x.id)?.version }));
  });
  if (n) {
    const { data: fin } = await db.from("profiles").select("id").in("role", ["finance", "owner"]);
    await pushTo(db, (fin || []).map((p: any) => p.id), (l) => ({ title: PUSH.pay_t[l], body: PUSH.pay_b[l].replace("{n}", String(n)), url: `/finance/invoices?r=${first}`, tag: `pay-${rec.id}` })).catch((e) => reportError(db, "automation:push", e));
  }
  return n;
}

/** A planned service is done: the unit's next service moves forward by its plan interval. */
async function serviceStamps(db: any, rec: any, ev: Ev) {
  if (ev.kind !== "status" || rec.section !== "operations.support" || !rec.data?.pm || !rec.data?.unit_ref) return;
  await step(db, async () => {
    const { data: u } = await db.from("records").select("id,section,status,data,version").eq("id", rec.data.unit_ref).maybeSingle();
    const ch = serviceDone(rec, u, today());
    return ch ? [{ op: "update", id: ch.id, set: { status: ch.status, data: ch.data }, if_version: u.version } as Op] : [];
  });
}

/** A change order is signed: its amount goes into the project payments (once) — all records in one transaction. */
async function changeOrderStamps(db: any, rec0: any, ev: Ev) {
  if (ev.kind !== "status" || rec0.section !== "legal.contracts" || rec0.status !== "Signed" || rec0.data?.type !== "Change order") return;
  let changed = false;
  await step(db, async () => {
    const { data: rec } = await db.from("records").select("*").eq("id", rec0.id).single();
    const { data: inv } = await db.from("records").select("id,section,title,status,data,version").eq("section", "finance.invoices").eq("data->>deal_ref", rec.data?.deal_ref || "-");
    const e = changeOrderEffects(rec, inv || [], today()); if (!e) { changed = false; return []; }
    changed = true; const ops: Op[] = [];
    if (e.create) ops.push({ op: "insert", row: { ...e.create, controlled: !!rec.controlled, company: null, created_by: rec.created_by ?? null } });
    if (e.update) ops.push({ op: "update", id: e.update.id, set: { data: e.update.data }, if_version: (inv || []).find((i: any) => i.id === e.update!.id)?.version });
    ops.push({ op: "update", id: rec.id, set: { data: e.co }, if_version: rec.version });
    return ops;
  });
  if (!changed) return;
  const { data: fin } = await db.from("profiles").select("id").in("role", ["finance", "owner"]);
  await pushTo(db, (fin || []).map((p: any) => p.id), (l) => ({ title: PUSH.co_t[l], body: `${rec0.title}`, url: `/legal/contracts?r=${rec0.id}`, tag: `co-${rec0.id}` })).catch((e) => reportError(db, "automation:push", e));
}

/** Called right after someone saves a record. Runs the matching rules once per record and status. */
export async function onRecordEvent(db: any, rec0: any, ev: Ev) {
  const { data: fresh } = await db.from("records").select("id,section,title,status,data,company,controlled,created_by,created_at,updated_at,version").eq("id", rec0.id).maybeSingle();
  let rec = fresh || rec0;
  // stamps on the record itself, written only if nobody changed it meanwhile
  rec = (await guarded(db, "automation:stamps", () => patchRecord(db, rec.id, (r) => {
    let d: Record<string, any> | null = null;
    if (ev.kind === "status") { const po = poStamps(ev.from, r, today()); if (po) d = po; }
    const sla = slaPatch(d ? { ...r, data: d } : r, ev); if (sla) d = sla;
    return d ? { data: d } : null;
  }), null)) || rec;
  await guarded(db, "automation:change-order", () => changeOrderStamps(db, rec, ev), undefined, { detail: rec.id });
  await guarded(db, "automation:service", () => serviceStamps(db, rec, ev), undefined, { detail: rec.id });
  await guarded(db, "automation:milestones", () => milestoneStamps(db, rec, ev), 0, { detail: rec.id });
  const next = ev.kind === "status" ? await guarded(db, "automation:repeat", () => repeatNext(db, rec), null, { detail: rec.id }) : null;
  const c = await context(db);
  if (next) c.log.push({ at: new Date().toISOString(), agent: "rules", kind: "action", text: `Repeating: next “${rec.title}” prepared`, record: next, section: rec.section } as any);
  if (c.settings.agents.rules === "off") { if (next) await save(c); return { matched: 0, next }; }
  const rules = (await getRules(db)).filter((r) => matchEvent(r, rec, ev));
  const keyOf = (r: Rule) => `${r.id}|${rec.id}|${ev.kind === "created" ? "new" : ev.to}`;
  const mine = await claim(c, rules.map((r) => ({ key: keyOf(r), repeat: null })));
  for (const r of rules) {
    if (!mine.has(keyOf(r))) continue;
    for (const [i, a] of r.actions.entries()) await act(c, "rules", a, rec, ruleMode(c, r), `Rule “${r.name}”`, `rule:${keyOf(r)}:${i}`);
  }
  if (mine.size) await flushMail(c, "AGRON Workspace: automatic update");
  if (mine.size || next || c.log.length) await save(c);
  return { matched: mine.size, next };
}

/* ---------------- Agents ---------------- */
async function rulesAgent(c: Ctx, recs: any[]) {
  // Date rules, plus a catch-up for status changes made outside the app (for example by another agent or an import)
  const rules = (await getRules(c.db)).filter((r) => r.enabled); const t = today();
  const todo: { key: string; r: Rule; rec: any; why: string }[] = [];
  for (const r of rules.filter((x) => x.on === "date")) for (const rec of recs) { const fire = dateDue(r, rec, t); if (fire) todo.push({ key: `${r.id}|${rec.id}|${fire}`, r, rec, why: `Rule “${r.name}”` }); }
  const since = new Date(Date.now() - 26 * 3600e3).toISOString();
  const { data: acts } = await c.db.from("activity").select("record_id,action,detail,created_at").in("action", ["status", "created"]).gte("created_at", since).limit(2000);
  const byId = new Map(recs.map((r) => [r.id, r]));
  for (const x of acts || []) {
    const rec = byId.get(x.record_id); if (!rec) continue;
    const ev: Ev = x.action === "created" ? { kind: "created" } : { kind: "status", from: x.detail?.from, to: x.detail?.to };
    for (const r of rules.filter((rr) => rr.on !== "date" && matchEvent(rr, rec, ev))) todo.push({ key: `${r.id}|${rec.id}|${ev.kind === "created" ? "new" : ev.to}`, r, rec, why: `Rule “${r.name}” (catch-up)` });
  }
  const mine = await claim(c, todo.map((x) => ({ key: x.key, repeat: null }))); let n = 0;
  for (const x of todo) { if (!mine.has(x.key)) continue; mine.delete(x.key); n++; for (const [i, a] of x.r.actions.entries()) await act(c, "rules", a, x.rec, ruleMode(c, x.r), x.why, `rule:${x.key}:${i}`); }
  return `${n} rule run(s)`;
}

/** Deadlines: items overdue for N days go to the leaders, grouped; open items due soon with nobody responsible are flagged. */
async function deadlinesAgent(c: Ctx, recs: any[]) {
  const s = c.settings.thresholds; const due = dueItems(recs as any, 7);
  const late = due.filter((x) => x.d <= -s.escalate_after);
  const nobody = due.filter((x) => x.d >= -1 && !PEOPLE_KEYS.some((k) => String(x.r.data?.[k] || "").trim()) && x.r.section !== "company.tasks");
  // Each item is raised once when it crosses the line, then again weekly while it stays open
  const mine = await claim(c, [...late.map((x) => ({ key: `late|${x.r.id}|${x.k}`, repeat: 7 })), ...nobody.map((x) => ({ key: `nobody|${x.r.id}|${x.k}`, repeat: 7 }))]);
  for (const x of late.filter((x) => mine.has(`late|${x.r.id}|${x.k}`))) tell(c, recipients(c, "leads", x.r), `<b>Overdue ${-x.d} days:</b> ${esc(x.r.title)} — ${esc(label(x.r.section))}${x.r.data?.owner ? ` (${esc(x.r.data.owner)})` : ""} — <a href="${recUrl(x.r)}">open</a>`);
  for (const x of nobody.filter((x) => mine.has(`nobody|${x.r.id}|${x.k}`))) tell(c, recipients(c, "leads", x.r), `<b>Nobody responsible</b>, ${x.d < 0 ? "overdue" : `due in ${x.d} days`}: ${esc(x.r.title)} — ${esc(label(x.r.section))} — <a href="${recUrl(x.r)}">open</a>`);
  return `${late.length} escalated, ${nobody.length} without owner`;
}

/** Compliance: every serious deal, vendor and partner gets a screening record; results come from the Consolidated Screening List when the key is set. */
async function complianceAgent(c: Ctx, recs: any[], mode: "auto" | "suggest") {
  const scr = recs.filter((r) => r.section === "security.screening");
  const has = (party: string, dealId?: string) => scr.some((s) => (dealId && s.data?.deal_ref === dealId) || String(s.data?.party || s.title).trim().toLowerCase() === party.trim().toLowerCase());
  let made = 0;
  for (const d of recs.filter((r) => r.section === "sales.pipeline" && ["Proposal", "Negotiation", "Won"].includes(r.status))) {
    const party = String(d.data?.client || d.title); if (has(party, d.id)) continue;
    await act(c, "compliance", { type: "create", section: "security.screening", title: party, status: "Pending", link: "deal_ref", fields: { party, party_type: "Client", country: "{country}", date: "{today}" } }, d, mode, `Deal “${d.title}” is at ${d.status} without a screening`, `screening:deal:${d.id}`); made++;
  }
  for (const [sec, type, st] of [["operations.vendors", "Vendor", ["Under review", "Approved"]], ["sales.partners", "Partner", ["Onboarding", "Active"]]] as const) {
    for (const v of recs.filter((r) => r.section === sec && (st as readonly string[]).includes(r.status))) {
      if (has(v.title)) continue;
      await act(c, "compliance", { type: "create", section: "security.screening", title: v.title, status: "Pending", fields: { party: v.title, party_type: type, country: "{country}", date: "{today}" } }, v, mode, `${type} “${v.title}” is ${v.status} without a screening`, `screening:party:${v.id}`); made++;
    }
  }
  // Automatic check against the US Consolidated Screening List
  let checked = 0; const key = process.env.CSL_API_KEY;
  if (key) for (const s of scr.filter((x) => x.status === "Pending" && !x.data?.csl_checked).slice(0, 5)) {
    try {
      const name = String(s.data?.party || s.title);
      const r = await fetch(`https://data.trade.gov/consolidated_screening_list/v1/search?name=${encodeURIComponent(name)}&fuzzy_name=true&size=5`, { headers: { "subscription-key": key }, cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`CSL answered ${r.status}`);
      const j = await r.json(); const hits = (j.results || []).filter((x: any) => (x.score ?? 100) >= 90);
      const note = hits.length ? `Automatic CSL check ${today()}: ${hits.length} possible match(es): ${hits.map((h: any) => `${h.name} (${h.source})`).join("; ")}` : `Automatic CSL check ${today()}: no matches on the US Consolidated Screening List.`;
      const status = hits.length ? "Flagged" : mode === "auto" ? "Cleared" : s.status;
      await patchRecord(c.db, s.id, (cur) => cur.data?.csl_checked ? null : { status, data: { ...cur.data, csl_checked: today(), lists: "US Consolidated Screening List (data.trade.gov)", result: [cur.data?.result, note].filter(Boolean).join("\n") } });
      await audit(c, "compliance", s, note); checked++;
      c.log.push({ at: new Date().toISOString(), agent: "compliance", kind: "action", text: `${s.title}: ${note}`, record: s.id, section: s.section });
      if (hits.length) tell(c, [...recipients(c, "role:security", s), ...recipients(c, "leads", s)], `<b style="color:#B4232F">Possible sanctions match:</b> ${esc(s.title)} — ${hits.length} hit(s). Work with this party is on hold until security decides. <a href="${recUrl(s)}">open</a>`);
      else if (mode !== "auto") tell(c, recipients(c, "role:security", s), `No CSL matches for ${esc(s.title)} — confirm and mark Cleared. <a href="${recUrl(s)}">open</a>`);
    } catch (e: any) { c.log.push({ at: new Date().toISOString(), agent: "compliance", kind: "error", text: `${s.title}: ${e?.message || e}` }); await reportError(c.db, "automation:csl", e, { detail: s.id }); }
  }
  // Waiting too long, and blocked deals (each raised once, then weekly)
  const wait = c.settings.thresholds.screening_wait;
  const waiting = scr.filter((x) => x.status === "Pending" && (Date.now() - Date.parse(x.created_at)) / 864e5 > wait);
  const bad = new Set(scr.filter((s) => ["Flagged", "Escalated"].includes(s.status) && s.data?.deal_ref).map((s) => s.data.deal_ref));
  const blocked = recs.filter((r) => r.section === "sales.pipeline" && bad.has(r.id) && ["Negotiation", "Won"].includes(r.status));
  const mine = await claim(c, [...waiting.map((x) => ({ key: `wait|${x.id}`, repeat: 7 })), ...blocked.map((x) => ({ key: `blocked|${x.id}`, repeat: 7 }))]);
  for (const s of waiting.filter((x) => mine.has(`wait|${x.id}`))) tell(c, recipients(c, "role:security", s), `Screening waiting more than ${wait} days: ${esc(s.title)} — <a href="${recUrl(s)}">open</a>`);
  for (const d of blocked.filter((x) => mine.has(`blocked|${x.id}`))) tell(c, recipients(c, "leads", d), `<b style="color:#B4232F">Deal with a flagged screening:</b> ${esc(d.title)} (${esc(d.status)}). Stop until cleared. <a href="${recUrl(d)}">open</a>`);
  return `${made} screening(s) prepared, ${checked} checked automatically${key ? "" : " (CSL key not set)"}`;
}

/** Data quality: fixes link names itself; reports the rest. A list is kept for System → Data quality. */
async function qualityAgent(c: Ctx, recs: any[], mode: "auto" | "suggest") {
  const issues = qualityIssues(recs, SECS, { staleDays: c.settings.thresholds.stale_record });
  const fixable = issues.filter((i) => i.fix);
  if (fixable.length) {
    if (mode === "auto") {
      for (const i of fixable) await patchRecord(c.db, i.id, (cur) => { const data = { ...cur.data }; for (const [k, v] of Object.entries(i.fix!)) { if (v === null) delete data[k]; else data[k] = v; } return { data }; }).catch((e) => reportError(c.db, "automation:quality", e, { detail: i.id }));
      c.log.push({ at: new Date().toISOString(), agent: "quality", kind: "action", text: `Fixed ${fixable.length} link(s)` });
    } else {
      c.queue.push({ agent: "quality", title: `Fix ${fixable.length} link(s) between records`, detail: fixable.slice(0, 8).map((i) => `${i.title}: ${i.detail}`).join("; "), action: { type: "set", field: "_quality_fix", value: "all" }, dedupe_key: "quality|fix-links" });
    }
  }
  const counts: Record<string, number> = {}; for (const i of issues) counts[i.kind] = (counts[i.kind] || 0) + 1;
  await saveState(c.db, "quality", { at: new Date().toISOString(), total: issues.length, counts });
  if (new Date().getUTCDay() === 1 && issues.length) for (const p of c.profiles.filter((x) => ["owner", "admin"].includes(x.role))) tell(c, [p], `Data quality: ${issues.length} item(s) to tidy — ${Object.entries(counts).map(([k, n]) => `${k.replace("_", " ")} ${n}`).join(", ")}. <a href="${SITE}/admin/system?tab=quality">open the list</a>`);
  return `${issues.length} issue(s), ${fixable.length} fixable`;
}
export async function applyQualityFixes(db: any) {
  const recs = await allRecords(db); const issues = qualityIssues(recs, SECS, { staleDays: 9999 }).filter((i) => i.fix); let n = 0;
  for (const i of issues) { const ok = await patchRecord(db, i.id, (cur) => { const data = { ...cur.data }; for (const [k, v] of Object.entries(i.fix!)) { if (v === null) delete data[k]; else data[k] = v; } return { data }; }).catch(() => null); if (ok) n++; }
  return n;
}

/** Monday brief for the CEO: numbers from the records (not US-persons-only), monitoring, approvals; AI writes 5 lines if the budget allows. */
async function briefAgent(c: Ctx, recsAll: any[], force: boolean) {
  if (!force && new Date().getUTCDay() !== 1) return "not Monday";
  const recs = recsAll.filter((r) => !r.controlled); const wk = Date.now() - 7 * 864e5; const in7 = (d: string) => Date.parse(d || "") >= wk;
  const of = (s: string) => recs.filter((r) => r.section === s); const usd = (r: any) => !r.data?.currency || r.data.currency === "USD"; const n = (v: any) => Number(v) || 0;
  const open = of("sales.pipeline").filter((r) => !["Won", "Lost"].includes(r.status));
  const won = of("sales.pipeline").filter((r) => r.status === "Won" && in7(r.updated_at));
  const inv = of("finance.invoices").filter((r) => !["Paid", "Draft"].includes(r.status) && usd(r));
  const overdueInv = inv.filter((r) => r.data?.due && r.data.due < today());
  const due = dueItems(recs as any, 0).filter((x) => x.d < 0);
  const byDept: Record<string, number> = {}; for (const x of due) { const d = x.r.section.split(".")[0]; byDept[d] = (byDept[d] || 0) + 1; }
  const [{ count: appr }, monitor, quality, queue] = await Promise.all([c.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"), readState(c.db, "monitor").catch(() => null), readState(c.db, "quality").catch(() => null), getQueue(c.db)]);
  const rows: [string, string][] = [
    ["Open pipeline", `${money(open.filter(usd).reduce((a, r) => a + n(r.data?.value), 0))} in ${open.length} deals`],
    ["Won this week", won.length ? `${won.length} — ${money(won.filter(usd).reduce((a, r) => a + n(r.data?.value), 0))}` : "none"],
    ["New leads this week", String(of("marketing.leads").filter((r) => in7(r.created_at)).length + of("sales.pipeline").filter((r) => in7(r.created_at)).length)],
    ["Receivables open", money(inv.filter((r) => r.data?.direction === "Receivable").reduce((a, r) => a + n(r.data?.amount), 0))],
    ["Invoices overdue", overdueInv.length ? `${overdueInv.length} — ${money(overdueInv.reduce((a, r) => a + n(r.data?.amount), 0))}` : "none"],
    ["Overdue items", due.length ? `${due.length}: ${Object.entries(byDept).sort((a, b) => b[1] - a[1]).map(([d, k]) => `${d} ${k}`).join(", ")}` : "none"],
    ["Builds in progress", String(of("operations.builds").filter((r) => !buildClosed(r.status)).length)],
    ["Open support tickets", String(of("operations.support").filter((r) => r.status !== "Resolved").length)],
    ["Screenings pending / flagged", `${of("security.screening").filter((r) => r.status === "Pending").length} / ${of("security.screening").filter((r) => ["Flagged", "Escalated"].includes(r.status)).length}`],
    ["Approvals waiting", String(appr || 0)],
    ["Automation proposals waiting", String(queue.filter((q) => q.status === "pending").length)],
    ["Monitoring", monitor ? (monitor.problems?.length ? `${monitor.problems.length} issue(s)` : "all OK") : "not run yet"],
    ["Data quality", quality ? `${quality.total} item(s) to tidy` : "not checked yet"],
  ];
  let ai = "";
  if (process.env.ANTHROPIC_API_KEY && !(await overBudget(c))) {
    try {
      const model = process.env.AI_MODEL_QUICK || "claude-sonnet-5-5";
      const m: any = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({ model, max_tokens: 500, system: "You write a Monday brief for the CEO of AGRON Inc. Use only the numbers given. Plain English, no hype.", messages: [{ role: "user", content: `Five short bullet points: what matters this week and which 3 decisions the CEO should make. Facts:\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}` }] });
      ai = (m.content || []).map((x: any) => x.text || "").join("").trim();
      const u = m.usage || {}; await c.db.from("ai_usage").insert({ user_id: c.profiles.find((p) => p.role === "owner")?.id || null, model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 }).then(() => {}, () => {});
    } catch {}
  }
  const html = `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:6px 0 14px">${rows.map(([k, v]) => `<tr><td style="border:1px solid #D5DCE4;padding:6px 8px;color:#5B6875;width:44%">${esc(k)}</td><td style="border:1px solid #D5DCE4;padding:6px 8px;color:#0E141A"><b>${esc(v)}</b></td></tr>`).join("")}</table>${ai ? `<p style="font-size:14px;color:#5B6875;margin:12px 0 4px">AI conclusions</p><div style="font-size:15px;line-height:1.6;color:#2A3440;white-space:pre-line">${esc(ai)}</div>` : ""}<p style="font-size:13px;color:#7A8796">US-persons-only records are not included. <a href="${SITE}/today">Open My day</a></p>`;
  const subject = `AGRON weekly brief — ${today()}`; let sent = 0;
  for (const p of c.profiles.filter((x) => c.settings.notify.brief_roles.includes(x.role))) {
    const m = await inLang(c, p, { subject, html, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") + (ai ? `\n\n${ai}` : "") });
    if (!(await sendMail({ to: p.email, subject: m.subject, html: renderEmail({ subject: m.subject, heading: m.subject, body: "", html: m.html, lang: (p.lang as any) || "en", sender: null }), text: m.text }))) sent++;
  }
  await saveState(c.db, "brief", { at: new Date().toISOString(), rows, ai, sent });
  return `sent to ${sent}`;
}

/* ---------------- Department agents ---------------- */
type Finder = (all: any[], today: string, th: Settings["thresholds"]) => Finding[];
const FINDERS: Partial<Record<AgentId, Finder>> = { finance: (all, t, th) => financeFindings(all, t, { ...th, cash: cashForecast(all, t), margin: projectMoney, dun: { stepFor, langOf: clientLang, letter: dunningLetter } }), sales: salesFindings, operations: (all, t, th) => operationsFindings(all, t, { ...th, sla: (x, f) => slaFor(x, f), parts: shortages, vendors: weakVendors }), hr: hrFindings, legal: legalFindings, marketing: marketingFindings, technical: technicalFindings, security: securityFindings };
const DEPT_OF: Partial<Record<AgentId, string>> = { finance: "finance", sales: "sales", operations: "operations", hr: "hr", legal: "legal", marketing: "marketing", technical: "technical", security: "security" };
const COLOR = { bad: "#B4232F", warn: "#A15C00", info: "#2A3440" };

/** Runs a department agent: tells people once (then every few days while it is still true) and runs or proposes the changes. */
async function deptAgent(c: Ctx, recs: any[], agent: AgentId, mode: "auto" | "suggest") {
  const finder = FINDERS[agent]; if (!finder) return "no checks";
  const t = today(); const found = finder(recs, t, c.settings.thresholds); let told = 0, acted = 0; const fresh: Finding[] = [];
  const mine = await claim(c, found.map((x) => ({ key: x.key, repeat: x.repeat ?? 7 })));
  for (const x of found) {
    if (!mine.has(x.key)) continue; mine.delete(x.key); fresh.push(x);
    const ppl = [...new Map(x.who.flatMap((w) => recipients(c, w, x.rec)).map((p) => [p.email, p])).values()];
    if (ppl.length) { tell(c, ppl, `<span style="color:${COLOR[x.level]}">${x.level === "bad" ? "<b>" : ""}${esc(x.text)}${x.level === "bad" ? "</b>" : ""}</span> — <a href="${recUrl(x.rec)}">open</a>`); told++; }
    if (x.action) { await act(c, agent, x.action, x.rec, mode, x.why || x.text, `finding:${x.key}:${t}`, `finding|${x.key}|${describeAction(x.action, x.rec)}`); acted++; }
  }
  if (agent === "sales") acted += await salesDrafts(c, recs, fresh);
  // What the agent sees now, for the department overview (titles only; access is checked when it is shown)
  await saveState(c.db, `agent-${agent}`, { at: new Date().toISOString(), items: found.slice(0, 60).map((x) => ({ level: x.level, text: x.text, id: x.rec.id, section: x.rec.section, controlled: !!x.rec.controlled, action: x.action ? describeAction(x.action, x.rec) : null })) });
  return `${found.length} finding(s), ${told} new notice(s), ${acted} change(s) ${mode === "auto" ? "made" : "proposed"}`;
}
/** Sales: letters to clients for stalled deals and expiring proposals, written by AI and waiting for approval (at most 5 a day). */
async function salesDrafts(c: Ctx, recs: any[], fresh: Finding[]) {
  if (!process.env.ANTHROPIC_API_KEY || (await overBudget(c))) return 0; let n = 0;
  for (const x of fresh.filter((f) => /^sal-(stall|valid)\|/.test(f.key)).slice(0, 5)) {
    const deal = x.rec.section === "sales.pipeline" ? x.rec : recs.find((r) => r.id === x.rec.data?.deal_ref);
    const to = deal ? dealEmail(deal, recs) : ""; if (!to || x.rec.controlled) continue;
    const kind = x.key.startsWith("sal-valid") ? "proposal" : "followup";
    const d = await draftEmail(c.db, kind, { client: deal.data?.client || deal.title, deal: deal.title, stage: deal.status, configuration: deal.data?.config, country: deal.data?.country, segment: deal.data?.segment, last_activity: deal.updated_at?.slice(0, 10), valid_until: x.rec.data?.valid_until, notes: String(deal.data?.notes || "").slice(0, 1500) });
    if (!d) continue;
    await act(c, "sales", { type: "email", to_field: "", to, subject: d.subject, body: d.body }, x.rec, "suggest", `AI draft (${d.lang}) — ${kind === "proposal" ? "proposal expiring" : "deal without movement"}`, undefined, `sales-draft|${x.key}`); n++;
  }
  return n;
}
/** Latest findings of a department agent that this person may see. */
export async function deptFindings(db: any, dept: string, me: { role: string; us_person: boolean }) {
  const agent = (Object.entries(DEPT_OF).find(([, d]) => d === dept) || [])[0]; if (!agent) return null;
  const st = await readState(db, `agent-${agent}`).catch(() => null); if (!st) return { agent, at: null, items: [] };
  const full = ["owner", "admin"].includes(me.role);
  const { data: acc } = full ? { data: [] } : await db.from("section_access").select("section").eq("role", me.role);
  const ok = new Set((acc || []).map((a: any) => a.section));
  return { agent, at: st.at, items: st.items.filter((i: any) => (full || ok.has(i.section)) && (!i.controlled || me.us_person)) };
}

/* ---------------- Email intake ---------------- */
const DEPT_ROLE: Record<string, string> = { technical: "engineering", company: "management", operations: "operations", finance: "finance", sales: "sales", marketing: "marketing", hr: "hr", legal: "legal", security: "security" };
/** New letters at info@agron1.com become records: right away in Auto mode, or as proposals with the attachments ready. */
async function intakeAgent(c: Ctx, mode: "auto" | "suggest") {
  if (await overBudget(c)) return "AI budget reached — mail not read";
  const r: any = await readInbox(c.db);
  if (r.skipped) return r.skipped;
  for (const it of r.items) {
    const a: Action = { type: "file", section: it.section, title: it.title, status: it.status, data: it.data, controlled: it.controlled, files: it.files, from: it.from, subject: it.subject, summary: it.summary };
    const now = new Date().toISOString(); const key = `intake|${r.validity || ""}|${it.uid}`;
    if (mode === "auto") {
      try { const res = await execute(c, "intake", a, { id: "", section: it.section, title: it.title, data: {} }, { idem: key }); c.log.push({ at: now, agent: "intake", kind: "action", text: `${describeAction(a, null)} → ${res}`, section: it.section }); }
      catch (e: any) { c.log.push({ at: now, agent: "intake", kind: "error", text: `${it.subject}: ${e?.message || e}` }); await reportError(c.db, "automation:intake", e, { detail: it.subject }); }
    } else {
      c.queue.push({ agent: "intake", title: describeAction(a, null), detail: [it.summary, it.reason].filter(Boolean).join(" — "), section: it.section, action: a, controlled: it.controlled, dedupe_key: key });
      c.log.push({ at: now, agent: "intake", kind: "queued", text: describeAction(a, null), section: it.section });
    }
  }
  // A first inquiry gets a reply draft in the client's language (always waits for approval)
  for (const it of r.items.filter((x: any) => x.section === "marketing.leads" && x.from && !x.controlled).slice(0, 5)) {
    const d = await draftEmail(c.db, "reply", { from: it.from, subject: it.subject, email: it.text });
    if (!d) continue;
    const a: Action = { type: "email", to_field: "", to: it.from, subject: d.subject, body: d.body };
    c.queue.push({ agent: "intake", title: describeAction(a, null), detail: `AI reply draft (${d.lang}) to a new inquiry: ${it.subject}`, section: "marketing.leads", action: a, dedupe_key: `intake-reply|${r.validity || ""}|${it.uid}` });
  }
  if (mode !== "auto" && r.items.length) for (const p of c.profiles.filter((x) => ["owner", "admin"].includes(x.role))) tell(c, [p], `${r.items.length} new email(s) at info@agron1.com are prepared for filing — <a href="${SITE}/admin/system?tab=auto">approve</a>`);
  return `${r.items.length} email(s) ${mode === "auto" ? "filed" : "prepared"}, ${r.ignored.length} skipped (newsletters, auto-replies, own mail)`;
}

/* ---------------- AI budget ---------------- */
export async function aiUsage(db: any, s: Settings) {
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
  const { data } = await db.from("ai_usage").select("user_id,model,input_tokens,output_tokens").gte("created_at", since.toISOString()).limit(20000);
  const by: Record<string, { tin: number; tout: number; n: number }> = {}; const models: Record<string, number> = {}; let tin = 0, tout = 0;
  for (const r of data || []) { const k = r.user_id || "automation"; by[k] ||= { tin: 0, tout: 0, n: 0 }; by[k].tin += r.input_tokens || 0; by[k].tout += r.output_tokens || 0; by[k].n++; tin += r.input_tokens || 0; tout += r.output_tokens || 0; models[r.model] = (models[r.model] || 0) + 1; }
  return { month: since.toISOString().slice(0, 7), requests: (data || []).length, tin, tout, usd: aiCost(tin, tout, s), budget: s.ai.monthly_usd, by: Object.entries(by).map(([id, v]) => ({ id, ...v, usd: aiCost(v.tin, v.tout, s) })).sort((a, b) => b.usd - a.usd), models };
}
async function overBudget(c: Ctx) { if (!c.settings.ai.monthly_usd) return false; const u = await aiUsage(c.db, c.settings); return u.usd >= u.budget; }

/* ---------------- Runner ---------------- */
/** Daily run (cron) or one agent on demand. Agents rest on weekends and company holidays unless started by hand. */
export async function runAgents(db: any, opts: { only?: AgentId; manual?: boolean } = {}) {
  const c = await context(db); const t = today(); const out: Record<string, string> = {};
  if (!opts.manual && !isWorkday(t, c.settings)) { c.log.push({ at: new Date().toISOString(), agent: "system", kind: "run", text: "Day off in the company calendar — agents rested" }); await save(c); return { rested: true }; }
  const recs = await allRecords(db);
  for (const a of AGENTS) {
    if (opts.only && opts.only !== a) continue;
    const mode = c.settings.agents[a]; if (mode === "off") { out[a] = "off"; continue; }
    try {
      out[a] = a === "intake" ? await intakeAgent(c, mode) : DEPT_AGENTS.includes(a) ? await deptAgent(c, recs, a, mode) : a === "rules" ? await rulesAgent(c, recs) : a === "deadlines" ? await deadlinesAgent(c, recs) : a === "compliance" ? await complianceAgent(c, recs, mode) : a === "quality" ? await qualityAgent(c, recs, mode) : await briefAgent(c, recs, !!opts.manual);
      c.log.push({ at: new Date().toISOString(), agent: a, kind: "run", text: out[a] });
    } catch (e: any) { out[a] = `error: ${e?.message || e}`; c.log.push({ at: new Date().toISOString(), agent: a, kind: "error", text: String(e?.message || e) }); await reportError(db, `agent:${a}`, e); }
  }
  out.emails = String(await flushMail(c, "AGRON Workspace: what the agents found today"));
  const proposals = c.queue.length;
  await save(c);
  if (proposals) { // new proposals wait for a decision
    const admins = c.profiles.filter((p) => ["owner", "admin"].includes(p.role)).map((p) => p.id);
    await pushTo(db, admins, (l) => ({ title: PUSH.queue_t[l], body: PUSH.queue_b[l].replace("{n}", String(proposals)), url: "/admin/system?tab=auto", tag: "queue" })).catch((e) => reportError(db, "automation:push", e));
  }
  await saveState(db, "agents", { at: new Date().toISOString(), result: out, manual: !!opts.manual });
  return out;
}

/** Runs a claimed queue item and records the outcome; a passing failure is retried with back-off, then dead-lettered. */
async function executeQueued(c: Ctx, row: Row): Promise<Row> {
  const db = c.db; const now = new Date().toISOString(); const a = row.action; const idem = `queue:${row.id}`;
  // Phase 6: an automatic process step is retried by the database itself (same step run, allow-listed action,
  // attempts and dead letter kept on this row) — hand the claim back and let wf_retry_due run it once
  if ((row as any).agent === "workflow") {
    await db.from("automation_queue").update({ status: "retrying", attempts: Math.max(0, (row.attempts || 1) - 1), next_attempt_at: now }).eq("id", row.id).eq("exec_id", row.exec_id);
    const { error } = await db.rpc("wf_retry_due", { p_limit: 20 }); if (error) await reportError(db, "automation:workflow", error, { detail: row.id });
    const { data } = await db.from("automation_queue").select("*").eq("id", row.id).single();
    return (data || row) as Row;
  }
  let ok = false, retry = false, result = "", error = "";
  try {
    if (a.type === "set" && a.field === "_quality_fix") result = `fixed ${await applyQualityFixes(db)}`;
    else if (a.type === "file") result = await execute(c, row.agent, a, { id: "", section: a.section, title: a.title, data: {} }, { idem, queueId: row.id });
    else if (!row.record_id && a.type === "email" && a.to) result = await execute(c, row.agent, a, { id: "", section: row.section || "", title: a.subject, data: {} }, { idem, queueId: row.id });
    else {
      const { data: rec } = await db.from("records").select("id,section,title,status,data,controlled,created_at,updated_at,version").eq("id", row.record_id).maybeSingle();
      if (!rec) throw new Error("The record no longer exists");
      result = await execute(c, row.agent, a, rec, { idem, queueId: row.id });
    }
    ok = true;
  } catch (e: any) { error = String(e?.message || e).slice(0, 1000); retry = e instanceof Retry; }
  const { data: fin, error: fe } = await db.rpc("automation_finish", { p_id: row.id, p_exec: row.exec_id, p_ok: ok, p_result: result || null, p_error: error || null, p_retry: retry });
  if (fe) await reportError(db, "automation:finish", fe, { detail: row.id });
  const done: Row = fin?.[0] || { ...row, status: ok ? "completed" : "failed", result, last_error: error };
  c.log.push({ at: now, agent: row.agent, kind: ok ? "decision" : "error", text: ok ? `Done: ${row.title} → ${result}` : `${row.title}: ${error}${done.status === "retrying" ? " (will retry)" : done.status === "dead" ? " (gave up)" : ""}`, record: row.record_id || undefined, section: row.section || undefined });
  if (done.status === "dead") await alertAdmins(db, { key: `dead|${row.id}`, subject: "AGRON Workspace: an automatic action gave up", lines: [`${row.title}`, `Tried ${done.attempts} times. Last error: ${error}`], repeatDays: 3650 }).catch(() => 0);
  return done;
}

/** Approve or reject a proposal from the queue. Only one decision can ever win; the action runs once. */
export async function decide(db: any, id: string, approve: boolean, by: { id: string; us_person: boolean; email: string }, edit?: { subject?: string; body?: string }) {
  const { data: cur } = await db.from("automation_queue").select("*").eq("id", id).maybeSingle();
  if (!cur || cur.status !== "pending") throw new Error("Already decided or not found");
  if (cur.controlled && !by.us_person) throw new Error("US-persons-only record: a US person must decide");
  let action: any = null;
  if (approve && edit && cur.action?.type === "email") { // the approver corrected the draft
    action = { ...cur.action };
    if (typeof edit.subject === "string" && edit.subject.trim()) action.subject = edit.subject.trim().slice(0, 200);
    if (typeof edit.body === "string" && edit.body.trim()) action.body = edit.body.trim().slice(0, 6000);
  }
  const { data: rows, error } = await db.rpc("automation_decide", { p_id: id, p_approve: approve, p_by: by.email, p_us_person: !!by.us_person, p_action: action });
  if (error) throw new Error(error.message);
  const row: Row | undefined = rows?.[0]; if (!row) throw new Error("Already decided or not found");
  const c = await context(db); const now = new Date().toISOString(); let out: Row = row;
  if (!approve) {
    if (row.action.type === "file" && (row.action as any).files?.length) await db.storage.from("files").remove((row.action as any).files.filter((p: string) => p.startsWith("_intake/mail/"))).catch((e: any) => reportError(db, "automation:intake-files", e));
    c.log.push({ at: now, agent: row.agent, kind: "decision", text: `Rejected by ${by.email}: ${row.title}` });
  } else {
    c.log.push({ at: now, agent: row.agent, kind: "decision", text: `Approved by ${by.email}: ${row.title}` });
    out = await executeQueued(c, row);
  }
  await flushMail(c, "AGRON Workspace: automatic update"); await save(c);
  return toItem(out);
}

/** Scheduled every 15 minutes: retries whose time has come, and work a stopped worker left half-way. */
export async function runRetries(db: any) {
  const stuck = await db.rpc("outbound_mark_stuck", { p_minutes: 10 }).then((r: any) => r.data || 0, () => 0);
  const { data: rows, error } = await db.rpc("automation_claim_due", { p_limit: 20, p_stale_minutes: 15 });
  if (error) throw new Error(error.message);
  const c = await context(db); const res: Record<string, number> = { claimed: (rows || []).length, completed: 0, retrying: 0, dead: 0, failed: 0, uncertain_marked: stuck };
  for (const r of rows || []) { const d = await executeQueued(c, r); res[d.status] = (res[d.status] || 0) + 1; }
  if (stuck) await alertAdmins(db, { key: `uncertain|${today()}`, subject: "AGRON Workspace: e-mail delivery needs a check", lines: [`${stuck} e-mail(s) to outside addresses may or may not have been delivered.`, "Check the Sent folder of info@agron1.com, then mark each one in Operations."] }).catch(() => 0);
  await flushMail(c, "AGRON Workspace: automatic update"); await save(c);
  return res;
}
/** An administrator sends a failed or dead item round again. */
export async function requeue(db: any, id: string, by: string) {
  const { data, error } = await db.rpc("automation_requeue", { p_id: id, p_by: by }); if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Only failed or dead items can be retried"); return toItem(data[0]);
}

/** Which keys are set (never their values) and what each one unlocks. */
export function integrations() {
  const has = (k: string) => !!process.env[k];
  return [
    { key: "SUPABASE_SERVICE_ROLE_KEY", on: has("SUPABASE_SERVICE_ROLE_KEY"), what: "Agents, backups, digests", need: true },
    { key: "CRON_SECRET", on: has("CRON_SECRET"), what: "Daily schedule (agents 10:00 UTC, digest 11:00 UTC)", need: true },
    { key: "SMTP_PASS", on: has("SMTP_PASS"), what: "Emails from info@agron1.com", need: true },
    { key: "ANTHROPIC_API_KEY", on: has("ANTHROPIC_API_KEY"), what: "AI answers, texts, summaries, Monday brief conclusions", need: true },
    { key: "BACKUP_PASSPHRASE", on: has("BACKUP_PASSPHRASE"), what: "Encryption of every backup (no backup is written without it)", need: true },
    { key: "BACKUP_S3_ENDPOINT", on: has("BACKUP_S3_ENDPOINT") && has("BACKUP_S3_BUCKET") && has("BACKUP_S3_KEY_ID") && has("BACKUP_S3_SECRET"), what: "Off-site backup store (S3-compatible: BACKUP_S3_ENDPOINT, _BUCKET, _REGION, _KEY_ID, _SECRET)", need: true },
    { key: "CSL_API_KEY", on: has("CSL_API_KEY"), what: "Automatic sanctions screening (Compliance agent)", need: false },
    { key: "YOUTUBE_API_KEY", on: has("YOUTUBE_API_KEY"), what: "YouTube statistics in Marketing → Channels", need: false },
    { key: "GITHUB_TOKEN", on: has("GITHUB_TOKEN"), what: "Private repository facts in Technical → Systems", need: false },
    { key: "GOOGLE_CLIENT_ID", on: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"), what: "Google Calendar two-way sync (with GOOGLE_CLIENT_SECRET)", need: false },
  ];
}
