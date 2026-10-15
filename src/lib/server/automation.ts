import Anthropic from "@anthropic-ai/sdk";
import { readState, saveState } from "./backup";
import { sendMail } from "./mailer";
import { renderEmail, SITE } from "@/lib/mail";
import { allSections } from "@/config/workspace.config.mjs";
import { REFS } from "@/config/links";
import { dueItems, isMine, money, PEOPLE_KEYS } from "@/lib/insights";
import { financeFindings, type Finding } from "@/lib/deptAgents";
import { AGENTS, DEPT_AGENTS, DEFAULT_RULES, aiCost, dateDue, isWorkday, matchEvent, qualityIssues, render, withDefaults, type Action, type AgentId, type Ev, type Rule, type Settings } from "@/lib/automation";

/**
 * Automation engine: company settings, "when → then" rules and agents.
 * State lives next to the backups (private bucket, JSON files) — no extra database tables.
 * Safety: changes from an agent in "suggest" mode, and every email to an outside address, wait in the approval queue.
 * Records marked "US persons only" are announced only to US persons. Every action is written to the agent log and the activity history.
 */
const SECS: any[] = allSections() as any[];
const label = (id: string) => SECS.find((s) => s.id === id)?.label?.en || id;
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => globalThis.crypto.randomUUID();
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const recUrl = (r: { id: string; section: string }) => `${SITE}/${r.section.replace(".", "/")}?r=${r.id}`;

export type LogEntry = { at: string; agent: AgentId | "system"; kind: "run" | "action" | "queued" | "error" | "decision"; text: string; record?: string; section?: string };
export type QueueItem = { id: string; at: string; agent: AgentId; title: string; detail: string; record_id?: string; section?: string; action: Action; status: "pending" | "approved" | "rejected" | "failed"; decided_by?: string; decided_at?: string; result?: string; controlled?: boolean };

/* ---------------- State ---------------- */
export const getSettings = async (db: any): Promise<Settings> => withDefaults(await readState(db, "settings").catch(() => null));
export const saveSettings = (db: any, s: any) => saveState(db, "settings", withDefaults(s));
export async function getRules(db: any): Promise<Rule[]> { const r = await readState(db, "rules").catch(() => null); return Array.isArray(r) ? r : DEFAULT_RULES; }
export const saveRules = (db: any, rules: Rule[]) => saveState(db, "rules", rules.slice(0, 200));
export async function getLog(db: any): Promise<LogEntry[]> { return ((await readState(db, "agentlog").catch(() => null)) as LogEntry[]) || []; }
export async function getQueue(db: any): Promise<QueueItem[]> { return ((await readState(db, "queue").catch(() => null)) as QueueItem[]) || []; }
async function addLog(db: any, items: LogEntry[]) { if (!items.length) return; const old = await getLog(db); await saveState(db, "agentlog", [...items.reverse(), ...old].slice(0, 500)); }
async function addQueue(db: any, items: QueueItem[]) {
  if (!items.length) return; const old = await getQueue(db);
  const pending = old.filter((q) => q.status === "pending"), done = old.filter((q) => q.status !== "pending").slice(0, 200);
  await saveState(db, "queue", [...items, ...pending, ...done].slice(0, 600));
}

/* ---------------- Context ---------------- */
type P = { id: string; email: string; full_name: string; role: string; us_person: boolean };
type Ctx = { db: any; settings: Settings; profiles: P[]; access: { section: string; role: string }[]; log: LogEntry[]; queue: QueueItem[]; mail: Map<string, { p: P; lines: string[] }>; fired: Record<string, string>; known: Set<string> };
async function context(db: any): Promise<Ctx> {
  const [settings, { data: profiles }, { data: access }, fired, queue] = await Promise.all([getSettings(db), db.from("profiles").select("id,email,full_name,role,us_person"), db.from("section_access").select("section,role"), readState(db, "fired").catch(() => null), getQueue(db)]);
  // Proposals already waiting or rejected are not proposed again
  const known = new Set(queue.filter((q) => q.status === "pending" || q.status === "rejected").map((q) => `${q.record_id}|${q.title}`));
  return { db, settings, profiles: (profiles || []).filter((p: P) => p.email && p.role !== "pending"), access: access || [], log: [], queue: [], mail: new Map(), fired: fired || {}, known };
}
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
function tell(c: Ctx, people: P[], line: string) { for (const p of people) { const e = c.mail.get(p.email) || { p, lines: [] }; if (!e.lines.includes(line)) e.lines.push(line); c.mail.set(p.email, e); } }
async function flushMail(c: Ctx, subject: string) {
  let sent = 0;
  for (const { p, lines } of c.mail.values()) {
    const html = `<p style="font-size:15px;line-height:1.6;color:#2A3440">Hello${p.full_name ? ` ${esc(p.full_name.split(" ")[0])}` : ""}, the Workspace automation has news for you:</p><ul style="padding-left:18px;font-size:15px;line-height:1.6;color:#2A3440">${lines.map((l) => `<li>${l}</li>`).join("")}</ul><p style="font-size:13px;color:#7A8796">Rules and agents: Administration → System → Automation.</p>`;
    const err = await sendMail({ to: p.email, subject, html: renderEmail({ subject, heading: subject, body: "", html, lang: "en", sender: null }), text: lines.map((l) => "- " + l.replace(/<[^>]+>/g, "")).join("\n") });
    if (!err) sent++; else c.log.push({ at: new Date().toISOString(), agent: "system", kind: "error", text: `Email to ${p.email}: ${err}` });
  }
  c.mail.clear(); return sent;
}
async function save(c: Ctx) {
  // forget fired keys older than 60 days
  const cut = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  for (const [k, d] of Object.entries(c.fired)) if (d < cut) delete c.fired[k];
  await Promise.all([addLog(c.db, c.log), addQueue(c.db, c.queue), saveState(c.db, "fired", c.fired)]);
}
const audit = (c: Ctx, agent: AgentId, rec: { id: string; section: string; title: string }, text: string) =>
  c.db.from("activity").insert({ record_id: rec.id, section: rec.section, actor: null, action: "automation", detail: { agent, title: rec.title, text } }).then(() => {}, () => {});

/* ---------------- Actions ---------------- */
function describeAction(a: Action, rec: any) {
  if (a.type === "create") return `Create “${render(a.title, rec, today())}” in ${label(a.section)}${a.status ? ` (${a.status})` : ""}`;
  if (a.type === "set") return `Set ${a.field} of “${rec.title}” to “${a.value}”`;
  if (a.type === "email") return `Email ${a.to || rec.data?.[a.to_field] || "(no address)"}: ${render(a.subject, rec)}`;
  return `Notify ${a.to.replace("role:", "")}: ${render(a.message, rec)}`;
}

/** Runs one action now. Returns a short result text. */
async function execute(c: Ctx, agent: AgentId, a: Action, rec: any): Promise<string> {
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
    const data: Record<string, any> = { _by: `agent:${agent}`, _from: rec.id };
    for (const [k, tpl] of Object.entries(a.fields || {})) { const v = render(tpl, rec, today()); if (v) data[k] = /^-?\d+(\.\d+)?$/.test(v) && /amount|value|qty/.test(k) ? Number(v) : v; }
    if (a.link) { data[a.link] = rec.id; data[`${a.link}_title`] = rec.title; }
    const title = render(a.title, rec, today()) || rec.title;
    const { data: made, error } = await db.from("records").insert({ section: a.section, title, status: a.status || null, data, controlled: !!rec.controlled, company: null }).select("id,section,title").single();
    if (error) throw new Error(error.message);
    await audit(c, agent, made, `Created from “${rec.title}” (${label(rec.section)})`);
    return `created ${made.id}`;
  }
  if (a.type === "set") {
    const patch: any = a.field === "status" ? { status: a.value } : { data: { ...(rec.data || {}), [a.field]: a.value } };
    const { error } = await db.from("records").update(patch).eq("id", rec.id); if (error) throw new Error(error.message);
    await audit(c, agent, rec, `Set ${a.field} to “${a.value}”`);
    return "updated";
  }
  if (a.type === "email") {
    const to = String(a.to || rec.data?.[a.to_field] || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`No valid email in “${a.to_field}”`);
    const subject = render(a.subject, rec); const body = render(a.body, rec);
    const err = await sendMail({ to, subject, html: renderEmail({ subject, body, lang: "en", sender: { name: "AGRON Inc.", email: "info@agron1.com" } }), text: body, replyTo: "info@agron1.com" });
    if (err) throw new Error(err);
    await audit(c, agent, rec, `Emailed ${to}: ${subject}`);
    return `emailed ${to}`;
  }
  return "nothing";
}

/** Executes now or puts into the approval queue, depending on the mode. Notifications to the team always go out. */
async function act(c: Ctx, agent: AgentId, a: Action, rec: any, mode: "auto" | "suggest", why: string) {
  const now = new Date().toISOString();
  if (a.type !== "notify" && (mode === "suggest" || a.type === "email")) {
    const k = `${rec.id}|${describeAction(a, rec)}`; if (c.known.has(k)) return; c.known.add(k);
    c.queue.push({ id: uid(), at: now, agent, title: describeAction(a, rec), detail: why, record_id: rec.id, section: rec.section, action: a, status: "pending", controlled: !!rec.controlled });
    c.log.push({ at: now, agent, kind: "queued", text: describeAction(a, rec), record: rec.id, section: rec.section });
    return;
  }
  try { const res = await execute(c, agent, a, rec); if (a.type !== "notify" || res !== "notified 0") c.log.push({ at: now, agent, kind: "action", text: `${describeAction(a, rec)} → ${res}`, record: rec.id, section: rec.section }); }
  catch (e: any) { c.log.push({ at: now, agent, kind: "error", text: `${describeAction(a, rec)}: ${e?.message || e}`, record: rec.id, section: rec.section }); }
}
const ruleMode = (c: Ctx, r: Rule): "auto" | "suggest" => (c.settings.agents.rules === "auto" ? r.mode : "suggest");

/* ---------------- Events from the app ---------------- */
/** Called right after someone saves a record. Runs the matching rules once per record and status. */
export async function onRecordEvent(db: any, rec: any, ev: Ev) {
  const c = await context(db);
  if (c.settings.agents.rules === "off") return { matched: 0 };
  const rules = (await getRules(db)).filter((r) => matchEvent(r, rec, ev));
  for (const r of rules) {
    const key = `${r.id}|${rec.id}|${ev.kind === "created" ? "new" : ev.to}`;
    if (c.fired[key]) continue; c.fired[key] = today();
    for (const a of r.actions) await act(c, "rules", a, rec, ruleMode(c, r), `Rule “${r.name}”`);
  }
  if (rules.length) { await flushMail(c, "AGRON Workspace: automatic update"); await save(c); }
  return { matched: rules.length };
}

/* ---------------- Agents ---------------- */
async function rulesAgent(c: Ctx, recs: any[]) {
  // Date rules, plus a catch-up for status changes made outside the app (for example by another agent or an import)
  const rules = (await getRules(c.db)).filter((r) => r.enabled); const t = today(); let n = 0;
  for (const r of rules.filter((x) => x.on === "date")) for (const rec of recs) {
    const fire = dateDue(r, rec, t); if (!fire) continue;
    const key = `${r.id}|${rec.id}|${fire}`; if (c.fired[key]) continue; c.fired[key] = t; n++;
    for (const a of r.actions) await act(c, "rules", a, rec, ruleMode(c, r), `Rule “${r.name}”`);
  }
  const since = new Date(Date.now() - 26 * 3600e3).toISOString();
  const { data: acts } = await c.db.from("activity").select("record_id,action,detail,created_at").in("action", ["status", "created"]).gte("created_at", since).limit(2000);
  const byId = new Map(recs.map((r) => [r.id, r]));
  for (const x of acts || []) {
    const rec = byId.get(x.record_id); if (!rec) continue;
    const ev: Ev = x.action === "created" ? { kind: "created" } : { kind: "status", from: x.detail?.from, to: x.detail?.to };
    for (const r of rules.filter((rr) => rr.on !== "date" && matchEvent(rr, rec, ev))) {
      const key = `${r.id}|${rec.id}|${ev.kind === "created" ? "new" : ev.to}`; if (c.fired[key]) continue; c.fired[key] = t; n++;
      for (const a of r.actions) await act(c, "rules", a, rec, ruleMode(c, r), `Rule “${r.name}” (catch-up)`);
    }
  }
  return `${n} rule run(s)`;
}

/** Deadlines: items overdue for N days go to the leaders, grouped; open items due soon with nobody responsible are flagged. */
async function deadlinesAgent(c: Ctx, recs: any[]) {
  const s = c.settings.thresholds; const due = dueItems(recs as any, 7);
  const late = due.filter((x) => x.d <= -s.escalate_after);
  const nobody = due.filter((x) => x.d >= -1 && !PEOPLE_KEYS.some((k) => String(x.r.data?.[k] || "").trim()) && x.r.section !== "company.tasks");
  // Each item is raised once when it crosses the line, then again weekly while it stays open
  const once = (k: string) => { const last = c.fired[k]; const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); if (last && last > wk) return false; c.fired[k] = today(); return true; };
  for (const x of late.filter((x) => once(`late|${x.r.id}|${x.k}`))) tell(c, recipients(c, "leads", x.r), `<b>Overdue ${-x.d} days:</b> ${esc(x.r.title)} — ${esc(label(x.r.section))}${x.r.data?.owner ? ` (${esc(x.r.data.owner)})` : ""} — <a href="${recUrl(x.r)}">open</a>`);
  for (const x of nobody.filter((x) => once(`nobody|${x.r.id}|${x.k}`))) tell(c, recipients(c, "leads", x.r), `<b>Nobody responsible</b>, ${x.d < 0 ? "overdue" : `due in ${x.d} days`}: ${esc(x.r.title)} — ${esc(label(x.r.section))} — <a href="${recUrl(x.r)}">open</a>`);
  // Deals with no movement
  const stalled = recs.filter((r) => r.section === "sales.pipeline" && !["Won", "Lost"].includes(r.status) && (Date.now() - Date.parse(r.updated_at)) / 864e5 > s.stalled_deal);
  for (const r of stalled.filter((r) => once(`stalled|${r.id}`))) tell(c, recipients(c, "owner", r), `<b>Deal without movement for ${Math.floor((Date.now() - Date.parse(r.updated_at)) / 864e5)} days:</b> ${esc(r.title)} (${esc(r.status)}) — <a href="${recUrl(r)}">open</a>`);
  return `${late.length} escalated, ${nobody.length} without owner, ${stalled.length} stalled deals`;
}

/** Compliance: every serious deal, vendor and partner gets a screening record; results come from the Consolidated Screening List when the key is set. */
async function complianceAgent(c: Ctx, recs: any[], mode: "auto" | "suggest") {
  const scr = recs.filter((r) => r.section === "security.screening");
  const has = (party: string, dealId?: string) => scr.some((s) => (dealId && s.data?.deal_ref === dealId) || String(s.data?.party || s.title).trim().toLowerCase() === party.trim().toLowerCase());
  let made = 0;
  for (const d of recs.filter((r) => r.section === "sales.pipeline" && ["Proposal", "Negotiation", "Won"].includes(r.status))) {
    const party = String(d.data?.client || d.title); if (has(party, d.id)) continue;
    await act(c, "compliance", { type: "create", section: "security.screening", title: party, status: "Pending", link: "deal_ref", fields: { party, party_type: "Client", country: "{country}", date: "{today}" } }, d, mode, `Deal “${d.title}” is at ${d.status} without a screening`); made++;
  }
  for (const [sec, type, st] of [["operations.vendors", "Vendor", ["Under review", "Approved"]], ["sales.partners", "Partner", ["Onboarding", "Active"]]] as const) {
    for (const v of recs.filter((r) => r.section === sec && (st as readonly string[]).includes(r.status))) {
      if (has(v.title)) continue;
      await act(c, "compliance", { type: "create", section: "security.screening", title: v.title, status: "Pending", fields: { party: v.title, party_type: type, country: "{country}", date: "{today}" } }, v, mode, `${type} “${v.title}” is ${v.status} without a screening`); made++;
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
      await c.db.from("records").update({ status, data: { ...s.data, csl_checked: today(), lists: "US Consolidated Screening List (data.trade.gov)", result: [s.data?.result, note].filter(Boolean).join("\n") } }).eq("id", s.id);
      await audit(c, "compliance", s, note); checked++;
      c.log.push({ at: new Date().toISOString(), agent: "compliance", kind: "action", text: `${s.title}: ${note}`, record: s.id, section: s.section });
      if (hits.length) tell(c, [...recipients(c, "role:security", s), ...recipients(c, "leads", s)], `<b style="color:#B4232F">Possible sanctions match:</b> ${esc(s.title)} — ${hits.length} hit(s). Work with this party is on hold until security decides. <a href="${recUrl(s)}">open</a>`);
      else if (mode !== "auto") tell(c, recipients(c, "role:security", s), `No CSL matches for ${esc(s.title)} — confirm and mark Cleared. <a href="${recUrl(s)}">open</a>`);
    } catch (e: any) { c.log.push({ at: new Date().toISOString(), agent: "compliance", kind: "error", text: `${s.title}: ${e?.message || e}` }); }
  }
  // Waiting too long, and blocked deals
  const wait = c.settings.thresholds.screening_wait;
  const once = (k: string) => { const last = c.fired[k]; const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); if (last && last > wk) return false; c.fired[k] = today(); return true; };
  for (const s of scr.filter((x) => x.status === "Pending" && (Date.now() - Date.parse(x.created_at)) / 864e5 > wait && once(`wait|${x.id}`))) tell(c, recipients(c, "role:security", s), `Screening waiting more than ${wait} days: ${esc(s.title)} — <a href="${recUrl(s)}">open</a>`);
  const bad = new Set(scr.filter((s) => ["Flagged", "Escalated"].includes(s.status) && s.data?.deal_ref).map((s) => s.data.deal_ref));
  for (const d of recs.filter((r) => r.section === "sales.pipeline" && bad.has(r.id) && ["Negotiation", "Won"].includes(r.status) && once(`blocked|${r.id}`))) tell(c, recipients(c, "leads", d), `<b style="color:#B4232F">Deal with a flagged screening:</b> ${esc(d.title)} (${esc(d.status)}). Stop until cleared. <a href="${recUrl(d)}">open</a>`);
  return `${made} screening(s) prepared, ${checked} checked automatically${key ? "" : " (CSL key not set)"}`;
}

/** Data quality: fixes link names itself; reports the rest. A list is kept for System → Data quality. */
async function qualityAgent(c: Ctx, recs: any[], mode: "auto" | "suggest") {
  const issues = qualityIssues(recs, SECS, { staleDays: c.settings.thresholds.stale_record });
  const fixable = issues.filter((i) => i.fix);
  if (fixable.length) {
    if (mode === "auto") {
      for (const i of fixable) { const r = recs.find((x) => x.id === i.id); if (!r) continue; const data = { ...r.data }; for (const [k, v] of Object.entries(i.fix!)) { if (v === null) delete data[k]; else data[k] = v; } await c.db.from("records").update({ data }).eq("id", r.id); }
      c.log.push({ at: new Date().toISOString(), agent: "quality", kind: "action", text: `Fixed ${fixable.length} link(s)` });
    } else if (!(await getQueue(c.db)).some((q) => q.status === "pending" && q.agent === "quality")) {
      c.queue.push({ id: uid(), at: new Date().toISOString(), agent: "quality", title: `Fix ${fixable.length} link(s) between records`, detail: fixable.slice(0, 8).map((i) => `${i.title}: ${i.detail}`).join("; "), action: { type: "set", field: "_quality_fix", value: "all" }, status: "pending" });
    }
  }
  const counts: Record<string, number> = {}; for (const i of issues) counts[i.kind] = (counts[i.kind] || 0) + 1;
  await saveState(c.db, "quality", { at: new Date().toISOString(), total: issues.length, counts });
  if (new Date().getUTCDay() === 1 && issues.length) for (const p of c.profiles.filter((x) => ["owner", "admin"].includes(x.role))) tell(c, [p], `Data quality: ${issues.length} item(s) to tidy — ${Object.entries(counts).map(([k, n]) => `${k.replace("_", " ")} ${n}`).join(", ")}. <a href="${SITE}/admin/system?tab=quality">open the list</a>`);
  return `${issues.length} issue(s), ${fixable.length} fixable`;
}
export async function applyQualityFixes(db: any) {
  const recs = await allRecords(db); const issues = qualityIssues(recs, SECS, { staleDays: 9999 }).filter((i) => i.fix); let n = 0;
  for (const i of issues) { const r = recs.find((x) => x.id === i.id); if (!r) continue; const data = { ...r.data }; for (const [k, v] of Object.entries(i.fix!)) { if (v === null) delete data[k]; else data[k] = v; } const { error } = await db.from("records").update({ data }).eq("id", r.id); if (!error) n++; }
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
    ["Builds in progress", String(of("operations.builds").filter((r) => r.status !== "Installed").length)],
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
  for (const p of c.profiles.filter((x) => c.settings.notify.brief_roles.includes(x.role))) if (!(await sendMail({ to: p.email, subject, html: renderEmail({ subject, heading: subject, body: "", html, lang: "en", sender: null }), text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") + (ai ? `\n\n${ai}` : "") }))) sent++;
  await saveState(c.db, "brief", { at: new Date().toISOString(), rows, ai, sent });
  return `sent to ${sent}`;
}

/* ---------------- Department agents ---------------- */
type Finder = (all: any[], today: string, th: Settings["thresholds"]) => Finding[];
const FINDERS: Partial<Record<AgentId, Finder>> = { finance: financeFindings };
const DEPT_OF: Partial<Record<AgentId, string>> = { finance: "finance" };
const COLOR = { bad: "#B4232F", warn: "#A15C00", info: "#2A3440" };

/** Runs a department agent: tells people once (then every few days while it is still true) and runs or proposes the changes. */
async function deptAgent(c: Ctx, recs: any[], agent: AgentId, mode: "auto" | "suggest") {
  const finder = FINDERS[agent]; if (!finder) return "no checks";
  const t = today(); const found = finder(recs, t, c.settings.thresholds); let told = 0, acted = 0;
  for (const x of found) {
    const last = c.fired[x.key]; const fresh = !last || last <= new Date(Date.now() - (x.repeat ?? 7) * 864e5).toISOString().slice(0, 10);
    if (!fresh) continue; c.fired[x.key] = t;
    const ppl = [...new Map(x.who.flatMap((w) => recipients(c, w, x.rec)).map((p) => [p.email, p])).values()];
    if (ppl.length) { tell(c, ppl, `<span style="color:${COLOR[x.level]}">${x.level === "bad" ? "<b>" : ""}${esc(x.text)}${x.level === "bad" ? "</b>" : ""}</span> — <a href="${recUrl(x.rec)}">open</a>`); told++; }
    if (x.action) { await act(c, agent, x.action, x.rec, mode, x.why || x.text); acted++; }
  }
  // What the agent sees now, for the department overview (titles only; access is checked when it is shown)
  await saveState(c.db, `agent-${agent}`, { at: new Date().toISOString(), items: found.slice(0, 60).map((x) => ({ level: x.level, text: x.text, id: x.rec.id, section: x.rec.section, controlled: !!x.rec.controlled, action: x.action ? describeAction(x.action, x.rec) : null })) });
  return `${found.length} finding(s), ${told} new notice(s), ${acted} change(s) ${mode === "auto" ? "made" : "proposed"}`;
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
      out[a] = DEPT_AGENTS.includes(a) ? await deptAgent(c, recs, a, mode) : a === "rules" ? await rulesAgent(c, recs) : a === "deadlines" ? await deadlinesAgent(c, recs) : a === "compliance" ? await complianceAgent(c, recs, mode) : a === "quality" ? await qualityAgent(c, recs, mode) : await briefAgent(c, recs, !!opts.manual);
      c.log.push({ at: new Date().toISOString(), agent: a, kind: "run", text: out[a] });
    } catch (e: any) { out[a] = `error: ${e?.message || e}`; c.log.push({ at: new Date().toISOString(), agent: a, kind: "error", text: String(e?.message || e) }); }
  }
  out.emails = String(await flushMail(c, "AGRON Workspace: what the agents found today"));
  await save(c);
  await saveState(db, "agents", { at: new Date().toISOString(), result: out, manual: !!opts.manual });
  return out;
}

/** Approve or reject a proposal from the queue. */
export async function decide(db: any, id: string, approve: boolean, by: { id: string; us_person: boolean; email: string }) {
  const q = await getQueue(db); const item = q.find((x) => x.id === id);
  if (!item || item.status !== "pending") throw new Error("Already decided or not found");
  if (item.controlled && !by.us_person) throw new Error("US-persons-only record: a US person must decide");
  const now = new Date().toISOString(); item.decided_by = by.email; item.decided_at = now;
  const c = await context(db);
  if (!approve) { item.status = "rejected"; c.log.push({ at: now, agent: item.agent, kind: "decision", text: `Rejected by ${by.email}: ${item.title}` }); }
  else {
    try {
      if (item.action.type === "set" && item.action.field === "_quality_fix") item.result = `fixed ${await applyQualityFixes(db)}`;
      else {
        const { data: rec } = await db.from("records").select("id,section,title,status,data,controlled,created_at,updated_at").eq("id", item.record_id).single();
        if (!rec) throw new Error("The record no longer exists");
        item.result = await execute(c, item.agent, item.action, rec);
      }
      item.status = "approved"; c.log.push({ at: now, agent: item.agent, kind: "decision", text: `Approved by ${by.email}: ${item.title} → ${item.result}` });
    } catch (e: any) { item.status = "failed"; item.result = e?.message || String(e); c.log.push({ at: now, agent: item.agent, kind: "error", text: `${item.title}: ${item.result}` }); }
  }
  await saveState(db, "queue", q);
  await flushMail(c, "AGRON Workspace: automatic update"); await addLog(db, c.log);
  return item;
}

/** Which keys are set (never their values) and what each one unlocks. */
export function integrations() {
  const has = (k: string) => !!process.env[k];
  return [
    { key: "SUPABASE_SERVICE_ROLE_KEY", on: has("SUPABASE_SERVICE_ROLE_KEY"), what: "Agents, backups, digests", need: true },
    { key: "CRON_SECRET", on: has("CRON_SECRET"), what: "Daily schedule (agents 10:00 UTC, digest 11:00 UTC)", need: true },
    { key: "SMTP_PASS", on: has("SMTP_PASS"), what: "Emails from info@agron1.com", need: true },
    { key: "ANTHROPIC_API_KEY", on: has("ANTHROPIC_API_KEY"), what: "AI answers, texts, summaries, Monday brief conclusions", need: true },
    { key: "BACKUP_PASSPHRASE", on: has("BACKUP_PASSPHRASE"), what: "Encrypted weekly backup sent by email", need: false },
    { key: "CSL_API_KEY", on: has("CSL_API_KEY"), what: "Automatic sanctions screening (Compliance agent)", need: false },
    { key: "YOUTUBE_API_KEY", on: has("YOUTUBE_API_KEY"), what: "YouTube statistics in Marketing → Channels", need: false },
    { key: "GITHUB_TOKEN", on: has("GITHUB_TOKEN"), what: "Private repository facts in Technical → Systems", need: false },
  ];
}
