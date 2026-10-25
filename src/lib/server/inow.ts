// 1inow — server side (P10). Reads one person's work from the existing Workspace engines WITH THAT PERSON'S OWN
// CLIENT (their JWT): every row comes through row-level security and the engines' own reading rule, so a record the
// person may not open contributes nothing — not a row, not a count, not a reason. Nothing is copied or cached.
// Each source is timed and isolated: one failing engine marks its section as unavailable, it never breaks My Day.
import { buildMyDay, type Item, type Signal, type State } from "@/lib/inow";
import { daysTo, isOpenTask, todayIso } from "@/lib/work";

export type Me = { id: string; role: string; full_name?: string | null; timezone?: string | null; us_person?: boolean };
export type SourceStatus = { ok: boolean; ms: number; error?: string };
const href = (section?: string | null, id?: string | null) => (section && id ? `/${section.replace(".", "/")}?r=${id}` : "/");
const hoursSince = (iso?: string | null, now = Date.now()) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 36e5)) : 0);
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
/** A wall-clock date and time in a time zone → epoch ms (the offset of that zone at that moment). */
export function zonedToUtc(date: string, time: string, tz?: string | null): number | null {
  const guess = Date.parse(`${date}T${time}:00Z`); if (!Number.isFinite(guess)) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    return guess - (shown - guess);
  } catch { return guess; }
}
export const localToday = (tz?: string | null, d = new Date()) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d); } catch { return todayIso(d); } };

/** One query per 80 ids (a long id list in one request exceeds the address length the API accepts). */
async function inChunks(ids: string[], q: (part: string[]) => PromiseLike<any>) {
  const parts: string[][] = []; for (let i = 0; i < ids.length; i += 80) parts.push(ids.slice(i, i + 80));
  const res = await Promise.all(parts.map((p) => q(p)));
  const err = res.find((r: any) => r?.error); if (err) return err;
  return { data: res.flatMap((r: any) => r?.data || []), error: null };
}
async function timed<T>(status: Record<string, SourceStatus>, name: string, fn: () => PromiseLike<T> | Promise<T>): Promise<T | null> {
  const t = Date.now();
  try { const r: any = await fn(); if (r && r.error) throw new Error(r.error.message || String(r.error)); status[name] = { ok: true, ms: Date.now() - t }; return r?.data !== undefined ? r.data : r; }
  catch (e: any) { status[name] = { ok: false, ms: Date.now() - t, error: "unavailable" }; return null; }
}

/** All of one person's work items, from every engine, with signals. */
export async function gatherItems(sb: any, me: Me, now = Date.now()) {
  const status: Record<string, SourceStatus> = {}; const today = localToday(me.timezone); const items: Item[] = [];
  const [tasks, meetings, procs, attention, waiting, loops, follow, mfg, commitments, states] = await Promise.all([
    timed(status, "tasks", () => sb.from("records").select("id,title,status,data,section,created_by,updated_at").eq("section", "company.tasks").eq("data->>assignee_id", me.id).limit(400)),
    timed(status, "meetings", () => sb.from("records").select("id,title,status,data,section").eq("section", "company.meetings").eq("data->>date", today).limit(50)),
    timed(status, "processes", () => sb.rpc("ops_my_processes")),
    timed(status, "attention", () => sb.rpc("attention_items", { p_limit: 40 })),
    timed(status, "waiting", () => sb.rpc("waiting_for")),
    timed(status, "open_loops", () => sb.rpc("open_loops")),
    timed(status, "commercial", () => sb.rpc("crm_followups", { p_scope: "mine" })),
    timed(status, "manufacturing", () => sb.rpc("mfg_today")),
    timed(status, "commitments", async () => {
      await sb.rpc("inow_detect_commitments", { p_days: 14 });
      const { data: cs, error } = await sb.from("inow_commitments").select("*").eq("status", "suggested").order("detected_at", { ascending: false }).limit(30);
      if (error) throw error;
      // the source record is read again with my rights: if I can no longer open it, its excerpt is not shown either
      const ids = [...new Set((cs || []).map((c: any) => c.record_id).filter(isUuid))];
      const { data: vis } = ids.length ? await sb.from("records").select("id,section").in("id", ids) : { data: [] };
      const sec = new Map(((vis as any[]) || []).map((r) => [r.id, r.section]));
      return (cs || []).filter((c: any) => sec.has(c.record_id)).map((c: any) => ({ ...c, source_section: sec.get(c.record_id) }));
    }),
    timed(status, "state", () => sb.from("inow_item_state").select("item_key,pinned,dismissed_at,not_relevant,snooze_until,remind_at")),
  ]);
  // tasks assigned to me (open); who is blocked by them
  const open = ((tasks as any[]) || []).filter((t) => isOpenTask(t));
  let blockedBy: Record<string, number> = {};
  if (open.length) {
    const ids = open.map((t) => t.id);
    const b = await timed(status, "dependencies", () => inChunks(ids, (part) => sb.from("records").select("id,data,status").eq("section", "company.tasks").in("data->>blocked_by", part).limit(500)));
    for (const x of ((b as any[]) || []).filter((x) => isOpenTask(x) && x.data?.assignee_id !== me.id)) blockedBy[x.data.blocked_by] = (blockedBy[x.data.blocked_by] || 0) + 1;
  }
  for (const t of open) {
    const d = daysTo(t.data?.due, today); const sig: Signal[] = [{ code: "assigned_to_me" }];
    if (d !== null && d < 0) sig.push({ code: "overdue", n: -d }); else if (d === 0) sig.push({ code: "due_today" }); else if (d === 1) sig.push({ code: "due_tomorrow" }); else if (d !== null && d <= 3) sig.push({ code: "due_soon", n: d });
    if (["High", "Critical"].includes(t.data?.priority)) sig.push({ code: t.data.priority === "Critical" ? "critical" : "priority_high" });
    if (blockedBy[t.id]) sig.push({ code: "blocks_others", n: blockedBy[t.id], text: blockedBy[t.id] === 1 ? "1 task" : `${blockedBy[t.id]} tasks` });
    if (isUuid(t.data?.blocked_by)) sig.push({ code: "blocked" });
    if (t.status === "Waiting") sig.push({ code: "waiting_on_person", text: "", n: Math.max(0, -(daysTo(String(t.updated_at).slice(0, 10), today) ?? 0)) });
    items.push({ mine: true, key: `task:${t.id}`, src: "task", kind: "task", title: t.title, link: href(t.section, t.id), record_id: t.id, section: t.section, due: t.data?.due || null, status: t.status,
      project: t.data?.project_ref ? { id: t.data.project_ref, title: t.data.project_ref_title || "" } : null, signals: sig });
  }
  // meetings today where I take part
  for (const m of ((meetings as any[]) || [])) {
    const mine = m.data?.organizer_id === me.id || (Array.isArray(m.data?.participants_ids) && m.data.participants_ids.includes(me.id));
    if (!mine || ["Cancelled", "Done", "Completed"].includes(m.status)) continue;
    const at = m.data?.time ? `${m.data.date}T${String(m.data.time).slice(0, 5)}` : null;
    const startUtc = at ? zonedToUtc(m.data.date, String(m.data.time).slice(0, 5), m.data?.timezone || me.timezone) : null;
    const mins = startUtc !== null ? Math.round((startUtc - now) / 6e4) : null;
    const sig: Signal[] = [mins !== null && mins >= -30 && mins <= 60 ? { code: "meeting_soon", n: Math.max(0, mins) } : { code: "meeting_today" }];
    items.push({ mine: true, key: `meeting:${m.id}`, src: "meeting", kind: "meeting", title: m.title, link: href(m.section, m.id), record_id: m.id, section: m.section, at, due: m.data?.date,
      project: m.data?.project_ref ? { id: m.data.project_ref, title: m.data.project_ref_title || "" } : null, signals: sig });
  }
  // approvals and workflow steps waiting for me: controlled — they are decided only on their own screen
  for (const x of (((procs as any) || {}).needs_action || []) as any[]) {
    const approval = /^Approve or reject/.test(x.reason || "");
    const sig: Signal[] = [{ code: "assigned_to_me" }];
    if (approval) sig.push({ code: "approval_waiting", n: x.due ? Math.max(0, 72 - Math.round((Date.parse(x.due) - now) / 36e5)) : 0 });
    else sig.push({ code: "decision_waiting" });
    if (x.due && Date.parse(x.due) < now) sig.push({ code: "sla_overdue" }); else if (x.due && String(x.due).slice(0, 10) === today) sig.push({ code: "due_today" });
    items.push({ mine: true, key: `${approval ? "approval" : "workflow"}:${x.record_id}:${x.run_id || ""}`, src: approval ? "approval" : "workflow", kind: approval ? "approval" : "step", title: x.title, link: href(x.section, x.record_id),
      record_id: x.record_id, section: x.section, due: x.due ? String(x.due).slice(0, 10) : null, controlled: true, required_next: x.reason || null, signals: sig });
  }
  // Attention (v22 engine): only what this person may open, with the engine's own reasons and next action
  for (const a of ((attention as any[]) || [])) {
    const sig: Signal[] = []; const k = String(a.kind || "");
    if (a.severity === "critical") sig.push({ code: "critical" });
    if (/overdue|late|missed/.test(k)) sig.push({ code: "overdue", n: Math.max(1, Math.round(hoursSince(a.since, now) / 24)) });
    if (/blocked|blocker/.test(k)) sig.push({ code: "blocked" });
    if (/stale|stalled|no_activity/.test(k)) sig.push({ code: "stalled", n: Math.round(hoursSince(a.since, now) / 24) });
    if (/approval/.test(k)) sig.push({ code: "approval_waiting", n: hoursSince(a.since, now) });
    if (/decision/.test(k)) sig.push({ code: "decision_waiting" });
    if (/project/.test(k) && ["critical", "high"].includes(a.severity)) sig.push({ code: "project_at_risk" });
    if (!sig.length) sig.push({ code: a.severity === "high" ? "priority_high" : "stalled", n: Math.round(hoursSince(a.since, now) / 24) });
    items.push({ mine: !!a.owner_id && a.owner_id === me.id, key: `attention:${a.item_key}`, src: "attention", kind: k, title: a.title, link: a.link || href(a.section, a.record_id), record_id: a.record_id, section: a.section, since: a.since,
      project: a.project_id ? { id: a.project_id, title: a.project_title || "" } : null, owner_id: a.owner_id, hint: a.next_action || null, signals: sig });
  }
  // Waiting For (v22): "others" = we wait on them; "me" = they wait on me (my debt); "external" = a Waiting task on
  // someone outside — its own waiting kind (Supplier / Customer / Partner) says who, read again with my rights
  const extIds = ((waiting as any[]) || []).filter((w) => w.party_type === "external" && isUuid(w.record_id)).map((w) => w.record_id);
  const extKind = new Map<string, string>();
  if (extIds.length) {
    const ek = (await timed(status, "waiting_kinds", () => inChunks(extIds, (ids) => sb.from("records").select("id,data").in("id", ids)))) as any[] || [];
    for (const r of ek) extKind.set(r.id, String(r.data?.waiting_kind || "").toLowerCase());
  }
  const partyOf = (w: any) => {
    if (w.party_type !== "external") return String(w.party_type || "");
    const k = extKind.get(w.record_id) || "";
    return /supplier|vendor|постав/.test(k) ? "vendor" : /customer|client|клиент|клієнт/.test(k) ? "customer" : /partner|партн/.test(k) ? "partner" : "external";
  };
  for (const w of ((waiting as any[]) || [])) {
    const party = partyOf(w); const age = Number(w.age_days || 0); const sig: Signal[] = [];
    if (w.bucket === "me") { sig.push({ code: "blocks_others", text: w.party_name || "" }); if (party === "customer") sig.push({ code: "customer_waiting", n: age }); }
    else if (party === "customer" || party === "client") sig.push({ code: "customer_waiting", n: age });
    else if (party === "vendor" || party === "supplier") sig.push({ code: "vendor_waiting", n: age });
    else if (party === "partner") sig.push({ code: "partner_waiting", n: age });
    else sig.push({ code: "waiting_on_person", n: age, text: w.party_name || "" });
    if (w.escalation === "due" || w.escalation === "escalate") sig.push({ code: "escalation_due" });
    if (w.due) { const d = daysTo(String(w.due), today); if (d !== null && d < 0) sig.push({ code: "overdue", n: -d }); else if (d === 0) sig.push({ code: "due_today" }); }
    items.push({ mine: true, key: `waiting:${w.item_key}`, src: w.bucket === "me" ? "attention" : "waiting", kind: w.kind, title: w.title, link: w.link || href(w.section, w.record_id), record_id: w.record_id, section: w.section,
      since: w.requested_at, due: w.due, project: w.project_id ? { id: w.project_id, title: w.project_title || "" } : null, signals: sig,
      waiting: { on: w.party_name, party: party || null, age_days: age, last_activity: w.last_activity, escalation: w.escalation, expected: w.due } });
  }
  // Open loops (v22): started or promised work without a conclusion
  for (const l of ((loops as any[]) || [])) {
    const sig: Signal[] = [{ code: "stalled", n: Number(l.age_days || 0) }]; if (l.severity === "high" || l.severity === "critical") sig.push({ code: "priority_high" });
    items.push({ mine: !!l.owner_id && l.owner_id === me.id, key: `loop:${l.loop_key}`, src: "loop", kind: l.kind, title: l.title, link: l.link || href(l.section, l.record_id), record_id: l.record_id, section: l.section, since: l.since,
      project: l.project_id ? { id: l.project_id, title: l.project_title || "" } : null, owner_id: l.owner_id, hint: l.next_action || null, signals: sig });
  }
  // commercial follow-ups (P7) due for me
  const f: any = follow || {};
  for (const o of (f.opportunities || []) as any[]) {
    const due = o.next_action_due || null; const d = daysTo(due, today); const sig: Signal[] = [{ code: "commercial_followup" }];
    if (d !== null && d < 0) sig.push({ code: "overdue", n: -d }); else if (d === 0) sig.push({ code: "due_today" });
    if (!due) sig.push({ code: "no_followup", n: o.last_at ? Math.round(hoursSince(o.last_at, now) / 24) : 0 });
    if (o.waiting_for) sig.push({ code: "customer_waiting", n: o.last_at ? Math.round(hoursSince(o.last_at, now) / 24) : 0 });
    items.push({ mine: true, key: `followup:${o.id}`, src: "followup", kind: "opportunity", title: `${o.number ? o.number + " " : ""}${o.title}${o.party ? " — " + o.party : ""}`, link: href("sales.pipeline", o.id), record_id: o.id, section: "sales.pipeline", due,
      required_next: o.next_action || null, signals: sig });
  }
  for (const l of (f.leads || []) as any[]) {
    const d = daysTo(l.follow_up, today); const sig: Signal[] = [{ code: "commercial_followup" }];
    if (d !== null && d < 0) sig.push({ code: "no_followup", n: -d }); else if (d === 0) sig.push({ code: "due_today" });
    items.push({ mine: true, key: `lead:${l.id}`, src: "lead", kind: "lead", title: l.title + (l.organization ? ` — ${l.organization}` : ""), link: href("marketing.leads", l.id), record_id: l.id, section: "marketing.leads", due: l.follow_up || null, signals: sig });
  }
  // shop floor (P8): my work orders and my blocked build units
  const g: any = mfg || {};
  for (const w of (g.work || []) as any[]) {
    const sig: Signal[] = [{ code: "assigned_to_me" }, { code: "manufacturing_impact" }]; if (w.status === "Blocked") sig.push({ code: "blocked" });
    const d = daysTo(w.planned, today); if (d !== null && d < 0) sig.push({ code: "overdue", n: -d }); else if (d === 0) sig.push({ code: "due_today" });
    items.push({ mine: true, key: `wo:${w.id}`, src: "work_order", kind: "work_order", title: `${w.number || ""} ${w.title}`.trim(), link: href("operations.work_orders", w.id), record_id: w.id, section: "operations.work_orders", due: w.planned || null, status: w.status, signals: sig });
  }
  for (const u of (g.my_units_blocked || []) as any[])
    items.push({ mine: true, key: `unit:${u.id}`, src: "unit", kind: "build_unit", title: `${u.number} — ${(u.reasons || [])[0] || "blocked"}`, link: href("operations.builds", u.id), record_id: u.id, section: "operations.builds",
      status: u.status, required_next: (u.reasons || [])[0] ? `Clear: ${(u.reasons || [])[0]}` : null, signals: [{ code: "build_blocked", text: u.number }, { code: "manufacturing_impact" }] });
  // commitments detected in my own comments: suggestions with evidence until I confirm them
  for (const c of ((commitments as any[]) || [])) {
    const sig: Signal[] = [{ code: "promised" }]; const d = c.due ? daysTo(c.due, today) : null;
    if (d !== null && d < 0) sig.push({ code: "overdue", n: -d }); else if (d === 0) sig.push({ code: "due_today" }); else if (d === 1) sig.push({ code: "due_tomorrow" });
    items.push({ mine: true, key: `commitment:${c.id}`, src: "commitment", kind: "commitment", title: c.excerpt.slice(0, 120), link: href(c.source_section, c.record_id), record_id: null, section: null, due: c.due,
      since: c.detected_at, evidence: { excerpt: c.excerpt, confidence: c.confidence, source_link: href(c.source_section, c.record_id) }, signals: sig });
  }
  return { items, states: ((states as any[]) || []) as State[], status, today };
}

/** My Day for the signed-in person. */
export async function myDay(sb: any, me: Me, now = Date.now()) {
  const t0 = Date.now(); const g = await gatherItems(sb, me, now);
  const day = buildMyDay(g.items, g.states, { now, today: g.today });
  return { ...day, today_date: g.today, sources: g.status, ms: Date.now() - t0, generated_at: new Date(now).toISOString() };
}

/**
 * Executive 1inow (owner / management): the company state in one or two minutes, from the existing v22–v25
 * management engines — still computed for this viewer only (a restricted record never changes a line or a count).
 */
export async function executive(sb: any, me: Me, now = Date.now()) {
  const status: Record<string, SourceStatus> = {}; const t0 = Date.now();
  const [day, exec, crm, ops, mfg] = await Promise.all([
    myDay(sb, me, now), timed(status, "exec", () => sb.rpc("exec_overview")), timed(status, "commercial", () => sb.rpc("crm_overview", { p_filter: {} })),
    timed(status, "operations", () => sb.rpc("ops_attention")), timed(status, "manufacturing", () => sb.rpc("mfg_exec")),
  ]);
  const e: any = exec || {};
  const take = (a: any[], n = 5) => (Array.isArray(a) ? a.slice(0, n) : []);
  return {
    now: day.now.filter((r) => r.priority === "HIGH").slice(0, 5),
    company_attention: take(e.attention || [], 6), decisions: [...day.decisions.slice(0, 5)], pending_decisions: e.pending_decisions ?? null,
    waiting: day.waiting.filter((w) => ["customer", "client", "vendor", "supplier", "partner"].includes(String(w.waiting?.party || ""))).slice(0, 6),
    commercial: crm ? { needs_action: (crm as any).needs_action ?? null, stalled: (crm as any).stalled ?? null, no_next_action: (crm as any).no_next_action ?? null, proposals_waiting: (crm as any).proposals_waiting ?? null, overdue: (crm as any).overdue ?? null, upcoming_decisions: (crm as any).upcoming_decisions ?? null } : null,
    operations: take((ops as any[]) || [], 6), manufacturing: mfg ? { blocked: (mfg as any).blocked ?? null, late: (mfg as any).late ?? null, shortages: (mfg as any).shortages ?? null, failed_tests: (mfg as any).failed_tests ?? null, nonconformances: (mfg as any).nonconformances ?? null, critical_procurement: (mfg as any).critical_procurement ?? null } : null,
    today: day.today.filter((r) => r.src === "meeting" || r.src === "approval").slice(0, 6), projects: take(e.projects || [], 8), portfolio: e.portfolio_health || null,
    sources: { ...day.sources, ...status }, ms: Date.now() - t0, generated_at: new Date(now).toISOString(),
  };
}

/** What changed — ranked by relevance to me: my items first, then my projects, then the rest (no raw audit log). */
export async function changes(sb: any, me: Me, windowName: "day" | "week" = "day") {
  const status: Record<string, SourceStatus> = {};
  const rows = ((await timed(status, "changes", () => sb.rpc("management_changes", { p_window: windowName }))) as any[]) || [];
  const mine = new Set<string>(); const projects = new Set<string>();
  const t = (await timed(status, "mine", () => sb.from("records").select("id,data").eq("section", "company.tasks").eq("data->>assignee_id", me.id).limit(400))) as any[] || [];
  for (const x of t) { mine.add(x.id); if (x.data?.project_ref) projects.add(x.data.project_ref); }
  const weight = (c: any) => (mine.has(c.record_id) ? 0 : c.project_id && projects.has(c.project_id) ? 1 : 2);
  const important = /blocked|overdue|decision|approved|rejected|stage|risk|received|shipped|failed|resolved/;
  const ranked = rows.map((c) => ({ ...c, relevance: weight(c), important: important.test(String(c.kind)) })).sort((a, b) => a.relevance - b.relevance || Number(b.important) - Number(a.important) || String(b.at).localeCompare(String(a.at)));
  return { window: windowName, items: ranked.slice(0, 40), total: rows.length, sources: status };
}

/** Meeting Brief: purpose, people, the related project's open loops, waiting items, recent changes and documents. */
export async function meetingBrief(sb: any, me: Me, meetingId: string) {
  const { data: m, error } = await sb.from("records").select("id,title,status,data,section").eq("id", meetingId).maybeSingle();
  if (error || !m || m.section !== "company.meetings") return null; // a meeting the person may not open does not exist for them
  const pid = isUuid(m.data?.project_ref) ? m.data.project_ref : null;
  const status: Record<string, SourceStatus> = {};
  // the project's name is read with my rights too (a project I may not open stays unnamed)
  const ptitle = pid && !m.data?.project_ref_title ? (((await timed(status, "project", () => sb.from("records").select("title").eq("id", pid).maybeSingle())) as any)?.title || "") : "";
  const [loops, waiting, chg, docs, people] = await Promise.all([
    pid ? timed(status, "open_loops", () => sb.rpc("open_loops", { p_project: pid })) : Promise.resolve([]),
    timed(status, "waiting", () => sb.rpc("waiting_for")),
    timed(status, "changes", () => sb.rpc("management_changes", { p_window: "week" })),
    pid ? timed(status, "documents", () => sb.from("records").select("id,title,status,section,updated_at").eq("section", "company.documents").eq("data->>project_ref", pid).order("updated_at", { ascending: false }).limit(8)) : Promise.resolve([]),
    timed(status, "people", () => sb.from("profiles").select("id,full_name").in("id", [m.data?.organizer_id, ...(m.data?.participants_ids || [])].filter(isUuid))),
  ]);
  return {
    meeting: { id: m.id, title: m.title, date: m.data?.date, time: m.data?.time, agenda: m.data?.agenda || null, status: m.status, project: pid ? { id: pid, title: m.data?.project_ref_title || ptitle || "" } : null },
    participants: ((people as any[]) || []).map((p) => ({ id: p.id, name: p.full_name })),
    open_actions: ((loops as any[]) || []).slice(0, 10),
    waiting: ((waiting as any[]) || []).filter((w) => !pid || w.project_id === pid).slice(0, 8),
    recent_changes: ((chg as any[]) || []).filter((c) => !pid || c.project_id === pid).slice(0, 8),
    decisions_needed: ((loops as any[]) || []).filter((l) => /decision/.test(String(l.kind))).slice(0, 5),
    documents: ((docs as any[]) || []), sources: status,
  };
}

/** End of day: done today, still open, newly waiting, unresolved attention, likely priorities for tomorrow. */
export async function endOfDay(sb: any, me: Me, now = Date.now()) {
  const g = await gatherItems(sb, me, now); const today = g.today;
  const { data: doneRows } = await sb.from("records").select("id,title,section,status,updated_at,data").eq("section", "company.tasks").eq("data->>assignee_id", me.id).in("status", ["Completed", "Done"]).gte("updated_at", `${today}T00:00:00Z`).limit(100);
  const day = buildMyDay(g.items, g.states, { now, today });
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
  return {
    completed: (doneRows || []).map((r: any) => ({ id: r.id, title: r.title, link: href(r.section, r.id) })),
    still_open: [...day.now, ...day.today].filter((r) => r.due === today || r.signals.some((s) => s.code === "overdue")),
    newly_waiting: day.waiting.filter((w) => String(w.since || "").slice(0, 10) === today),
    unresolved_attention: day.attention.slice(0, 8),
    tomorrow: [...day.today, ...day.attention].filter((r) => r.due === tomorrow).slice(0, 8),
    sources: g.status,
  };
}
