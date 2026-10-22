// Safe actions for the Assistant, voice commands and the Voice Inbox. One layer for all of them:
//   plan     → parse (src/lib/voice.ts), resolve people / tasks with the person's own rights, classify the risk,
//              store the proposal in action_audit (never trusted from the browser later)
//   start    → only a stored proposal of this person; READ needs nothing, LOW and MATERIAL need the confirmation,
//              CONTROLLED is never carried out here (approvals, access, deletions, external messages keep their flows).
//              It returns the exact record operations (re-read under the person's rights, with each record's version)
//   (browser)→ carries them out through the ordinary Workspace store (src/lib/store.ts) — the same spend-limit and
//              export checks, version check, automation and translation as a change made by hand. Voice holds no
//              mutation logic of its own.
//   complete → the server checks every reported result against the database (the record exists, this person made
//              it / the version moved on) and stores the result and the exact reversal
//   undo     → only where reversal is exact: a record this action created (if nobody changed it since), or the
//              previous value of the fields it changed (same condition). Comments and notes have no undo.
import { describe, nameMatches, parseCommand, type Parsed } from "@/lib/voice";
import { isOpenTask } from "@/lib/work";

export type Ctx = { user: any; admin: any; me: { id: string; role: string; full_name?: string | null; email?: string | null; timezone?: string | null }; lang?: string };
type Resolved = { person?: { id: string; name: string }; task?: { id: string; title: string; version?: number; data: any; status: string | null }; project?: { id: string; title: string } };
export type Op = { op: "create"; section: string; title: string; status: string | null; data: any } | { op: "update"; id: string; section: string; title: string; status: string | null; data: any; version: number; patch: any; prev?: { status: string | null; fields: Record<string, any> } } | { op: "comment"; id: string; section: string; body: string } | { op: "delete"; id: string; section: string; version: number };
export type PlanOut = { id: string; status: "proposed" | "needs_clarification" | "rejected"; intent: string; risk: string; summary: string; question?: string; options?: { id: string; label: string }[];
  route?: string; slots: Parsed["slots"]; resolved: Resolved; needsConfirmation: boolean; ops?: any[] };

const INTERNAL_OK = (role: string) => !["partner", "vendor", "investor", "pending"].includes(role);
const today = (tz?: string | null) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
const nameOf = (p: any) => p?.full_name || p?.email || "";
const T = (lang: string | undefined, en: string, ru: string) => (lang === "ru" || lang === "uk" ? ru : en);

async function people(c: Ctx) {
  const { data } = await c.user.from("profiles").select("id,full_name,email,role,disabled").limit(1000);
  return (data || []).filter((p: any) => !p.disabled && INTERNAL_OK(p.role));
}
async function findPerson(c: Ctx, spoken: string) {
  const list = await people(c);
  const me = /^(me|myself|мне|себе|меня|мені|собі)$/i.test(spoken.trim()) ? list.filter((p: any) => p.id === c.me.id) : [];
  return me.length ? me : list.filter((p: any) => nameMatches(spoken, nameOf(p)) || nameMatches(spoken, String(p.email || "").split("@")[0].replace(/[._-]/g, " ")));
}
async function findTask(c: Ctx, words: string) {
  const { data } = await c.user.rpc("search_records", { q: words, n: 20 });
  const open = (data || []).filter((r: any) => r.section === "company.tasks" && isOpenTask(r));
  const exact = open.filter((r: any) => r.title.trim().toLowerCase() === words.trim().toLowerCase());
  return exact.length ? exact : open;
}

/** Turn words into a stored proposal. Nothing changes here. */
export async function plan(c: Ctx, text: string, source: "voice" | "voice_inbox" | "text" | "assistant"): Promise<PlanOut> {
  if (!INTERNAL_OK(c.me.role)) throw Object.assign(new Error(T(c.lang, "Not allowed for your role", "Недоступно для вашей роли")), { status: 403 });
  const p = parseCommand(text, today(c.me.timezone));
  const resolved: Resolved = {}; let question: string | undefined; let options: { id: string; label: string }[] | undefined;
  const ask = (q: string, o?: { id: string; label: string }[]) => { if (!question) { question = q; options = o; } };
  let risk = p.risk;

  if (p.intent === "controlled") ask(T(c.lang, "Approvals, access changes, deletions and outside e-mails are not done by voice or the Assistant. Open the record and use its approval or settings.", "Согласования, изменения доступа, удаления и внешние письма не выполняются голосом или Ассистентом. Откройте запись и используйте её согласование или настройки."));
  if (p.intent === "unknown") ask(T(c.lang, "What should this become: a task, a reminder or a note?", "Что из этого сделать: задачу, напоминание или заметку?"));
  for (const m of p.missing) ask(m === "date" ? T(c.lang, "To which date?", "На какую дату?") : m === "task" ? T(c.lang, "Which task?", "Какую задачу?") : m === "person" ? T(c.lang, "Who should do it?", "Кому?") : m === "title" ? T(c.lang, "What exactly?", "Что именно?") : T(c.lang, "What should I look for?", "Что найти?"));

  if (p.slots.person && !question) {
    const found = await findPerson(c, p.slots.person);
    if (found.length === 1) resolved.person = { id: found[0].id, name: nameOf(found[0]) };
    else if (!found.length) ask(T(c.lang, `I do not know who “${p.slots.person}” is. Who should do it?`, `Не знаю, кто такой «${p.slots.person}». Кому поручить?`));
    else ask(T(c.lang, `Which ${p.slots.person}?`, `Какой именно — ${p.slots.person}?`), found.slice(0, 6).map((x: any) => ({ id: x.id, label: nameOf(x) })));
  }
  if (p.slots.task && !question && ["assign_task", "change_due_date", "complete_task"].includes(p.intent)) {
    const found = await findTask(c, p.slots.task);
    if (found.length === 1) resolved.task = { id: found[0].id, title: found[0].title, data: found[0].data, status: found[0].status };
    else if (!found.length) ask(T(c.lang, `No open task “${p.slots.task}” that you can open.`, `Нет открытой задачи «${p.slots.task}», доступной вам.`));
    else ask(T(c.lang, "Which task?", "Какую задачу?"), found.slice(0, 6).map((x: any) => ({ id: x.id, label: x.title })));
  }
  if (p.intent === "create_task") risk = !resolved.person || resolved.person.id === c.me.id ? "low" : "material";
  let route = p.route;
  if (["open_project", "search_project", "search_document", "search_person"].includes(p.intent) && p.slots.query) {
    if (p.intent === "open_project") {
      const { data } = await c.user.rpc("corp_search", { p_q: p.slots.query, p_types: ["project"], p_limit: 5 });
      if ((data || []).length === 1) route = data[0].link; else route = `/search?q=${encodeURIComponent(p.slots.query)}&kind=project`;
    } else route = `/search?q=${encodeURIComponent(p.slots.query)}&kind=${p.intent === "search_document" ? "document" : p.intent === "search_person" ? "person" : "project"}`;
  }
  const status: PlanOut["status"] = p.intent === "controlled" ? "rejected" : question ? "needs_clarification" : "proposed";
  const interpreted = { intent: p.intent, slots: p.slots, resolved, route, confidence: p.confidence };
  const { data: a, error } = await c.admin.from("action_audit").insert({ user_id: c.me.id, source, command: text.slice(0, 2000), intent: p.intent, risk, interpreted, status, question: question || null }).select("id").single();
  if (error) throw error;
  return { id: a.id, status, intent: p.intent, risk, summary: describe(p, (c.lang as any) || "en"), question, options, route, slots: p.slots, resolved, needsConfirmation: risk === "low" || risk === "material" };
}

/** Record a reviewed Assistant command plan (create / update / comment operations) as a proposal to confirm. */
export async function planOps(c: Ctx, text: string, ops: any[], records: Record<string, any>) {
  const material = ops.some((o) => o.op === "update" || (o.op === "create" && !(o.section === "company.tasks" && (!o.data?.assignee_id || o.data.assignee_id === c.me.id))));
  const { data: a, error } = await c.admin.from("action_audit").insert({ user_id: c.me.id, source: "assistant", command: text.slice(0, 2000), intent: "command_plan", risk: ops.length ? (material ? "material" : "low") : "read",
    interpreted: { ops, before: Object.fromEntries(Object.entries(records || {}).map(([k, r]: [string, any]) => [k, { version: r?.version ?? null }])) }, status: ops.length ? "proposed" : "needs_clarification" }).select("id").single();
  if (error) throw error;
  return a.id as string;
}

async function loadOwn(c: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await c.admin.from("action_audit").select("*").eq("id", id).eq("user_id", c.me.id).maybeSingle();
  return data;
}
export const link = (r: { section: string; id: string }) => (r.section === "company.projects" ? `/projects/${r.id}` : `/${r.section.replace(".", "/")}?r=${r.id}`);
const recOf = async (c: Ctx, id: string) => (await c.user.from("records").select("id,section,title,status,data,version,created_by,created_at").eq("id", id).maybeSingle()).data;
const prevOf = (cur: any, patch: any) => ({ status: cur.status ?? null, fields: Object.fromEntries(Object.keys(patch || {}).map((k) => [k, cur.data?.[k] ?? null])) });
const stamp = (c: Ctx, id: string, patch: any) => c.admin.from("action_audit").update(patch).eq("id", id).eq("user_id", c.me.id);

/** The record operations of a confirmed proposal, re-read now under the person's rights (never from the browser). */
async function buildOps(c: Ctx, a: any, it: any): Promise<Op[]> {
  if (a.intent === "command_plan") {
    const out: Op[] = [];
    for (const op of it.ops || []) {
      if (op.op === "create") out.push({ op: "create", section: op.section, title: String(op.title || "").slice(0, 300), status: op.status ?? null, data: op.data || {} });
      else if (op.op === "update" || op.op === "comment") {
        const cur = await recOf(c, op.id); if (!cur) throw new Error(T(c.lang, "Record not found", "Запись не найдена"));
        const before = it.before?.[op.id]?.version; if (before != null && cur.version !== before) throw new Error(T(c.lang, "The record changed since the proposal — ask again.", "Запись изменилась после предложения — спросите ещё раз."));
        if (op.op === "update") out.push({ op: "update", id: cur.id, section: cur.section, title: cur.title, status: op.status ?? cur.status, data: { ...(cur.data || {}), ...(op.data || {}) }, version: cur.version, patch: op.data || {}, prev: prevOf(cur, op.data || {}) });
        else out.push({ op: "comment", id: cur.id, section: cur.section, body: String(op.body || "").slice(0, 4000) });
      }
    }
    return out;
  }
  if (a.intent === "create_task" || a.intent === "create_reminder") {
    const who = it.resolved?.person || { id: c.me.id, name: nameOf(c.me) };
    const reminder = a.intent === "create_reminder"; const follow = it.as === "followup";
    const data: any = { assignee_id: who.id, assignee: who.name, priority: "Normal", source: "voice", voice_action: a.id, ...(it.slots?.date ? { due: it.slots.date } : {}), ...(reminder ? { reminder: true } : {}),
      ...(it.project?.id ? { project_ref: it.project.id, project_ref_title: it.project.title } : {}),
      ...(it.deal?.id ? { deal_ref: it.deal.id, deal_ref_title: it.deal.title } : {}),
      ...(who.id !== c.me.id ? { requested_by: c.me.id, requested_by_name: nameOf(c.me) } : {}) };
    const title = (follow ? T(c.lang, "Follow up: ", "Проконтролировать: ") : "") + String(it.slots?.title || "").slice(0, 200);
    return [{ op: "create", section: "company.tasks", title, status: "New", data }];
  }
  if (["assign_task", "change_due_date", "complete_task"].includes(a.intent)) {
    const cur = await recOf(c, it.resolved?.task?.id || "");
    if (!cur || cur.section !== "company.tasks") throw new Error(T(c.lang, "Task not found", "Задача не найдена"));
    const patch: any = {}; let status = cur.status;
    if (a.intent === "assign_task") { patch.assignee_id = it.resolved.person.id; patch.assignee = it.resolved.person.name; }
    if (a.intent === "change_due_date") patch.due = it.slots.date;
    if (a.intent === "complete_task") { status = "Completed"; patch.completed_at = today(c.me.timezone); }
    return [{ op: "update", id: cur.id, section: cur.section, title: cur.title, status, data: { ...(cur.data || {}), ...patch }, version: cur.version, patch, prev: prevOf(cur, patch) }];
  }
  return [];
}

/**
 * Begin a stored proposal. `confirm` is the person's explicit yes; it is required for every write. Returns the
 * operations for the browser to carry out through the ordinary store, or (READ) the place to open.
 */
export async function start(c: Ctx, id: string, o: { confirm?: boolean; personId?: string; taskId?: string } = {}) {
  const a = await loadOwn(c, id);
  if (!a) return { ok: false, status: 404, error: "Not found" };
  if (a.risk === "controlled" || a.status === "rejected") return { ok: false, status: 403, error: T(c.lang, "This action is not done here — use the record's approval or settings.", "Это действие здесь не выполняется — используйте согласование или настройки записи.") };
  if (!["proposed", "needs_clarification"].includes(a.status)) return { ok: false, status: 409, error: `Already ${a.status}` };
  const it = a.interpreted || {};
  // a clarification answered by choosing an option (person or task) — re-checked under the person's rights
  if (a.status === "needs_clarification") {
    if (o.personId) { const list = await people(c); const p = list.find((x: any) => x.id === o.personId); if (!p) return { ok: false, status: 400, error: "Unknown person" }; it.resolved = { ...it.resolved, person: { id: p.id, name: nameOf(p) } }; }
    if (o.taskId) { const t = await recOf(c, String(o.taskId)); if (!t || t.section !== "company.tasks") return { ok: false, status: 400, error: "Unknown task" }; it.resolved = { ...it.resolved, task: { id: t.id, title: t.title, data: t.data, status: t.status } }; }
    const stillMissing = (it.intent === "assign_task" && (!it.resolved?.person || !it.resolved?.task)) || (["change_due_date", "complete_task"].includes(it.intent) && !it.resolved?.task)
      || (it.intent === "change_due_date" && !it.slots?.date) || (it.intent === "create_task" && it.slots?.person && !it.resolved?.person) || (["create_task", "create_reminder", "note"].includes(it.intent) && !it.slots?.title);
    if (stillMissing || ["unknown", "command_plan"].includes(it.intent) || a.intent === "command_plan") return { ok: false, status: 409, error: a.question || T(c.lang, "Needs clarification", "Нужно уточнение") };
    // the risk follows the resolved person: a task for someone else is a material write
    if (it.intent === "create_task") a.risk = it.resolved?.person && it.resolved.person.id !== c.me.id ? "material" : "low";
  }
  if (a.risk === "read") { await stamp(c, id, { status: "executed", executed_at: new Date().toISOString(), result: { route: it.route }, interpreted: it }); return { ok: true, route: it.route, ops: [] }; }
  if (!o.confirm) return { ok: false, status: 409, error: T(c.lang, "Confirm first.", "Сначала подтвердите.") };
  let ops: Op[];
  try { ops = await buildOps(c, a, it); }
  catch (e: any) { await stamp(c, id, { status: "failed", error: String(e?.message || e).slice(0, 500), interpreted: it, risk: a.risk }); return { ok: false, status: 409, error: String(e?.message || e) }; }
  const now = new Date().toISOString();
  await stamp(c, id, { status: "confirmed", confirmed_at: now, interpreted: { ...it, planned: ops }, risk: a.risk });
  if (!ops.length) { await stamp(c, id, { status: "executed", executed_at: now, result: { note: it.slots?.title || null } }); return { ok: true, ops: [], note: true, undoable: false }; }
  return { ok: true, ops };
}

type Reported = { ok: boolean; id?: string; comment?: string; error?: string };
/**
 * The browser reports what the store did; every claim is checked against the database under the person's rights
 * before it enters the audit. The reversal kept is exact or there is none.
 */
export async function complete(c: Ctx, id: string, reported: Reported[]) {
  const a = await loadOwn(c, id);
  if (!a) return { ok: false, status: 404, error: "Not found" };
  if (a.status !== "confirmed") return { ok: false, status: 409, error: `Not in progress (${a.status})` };
  const planned: Op[] = a.interpreted?.planned || [];
  const out: any[] = []; const undos: any[] = []; let allOk = true; let noUndo = false; const errors: string[] = [];
  for (const [k, op] of planned.entries()) {
    const r = reported?.[k];
    if (!r?.ok) { allOk = false; errors.push(String(r?.error || "not done").slice(0, 200)); out.push({ op: op.op, ok: false, error: r?.error || "not done" }); continue; }
    if (op.op === "create") {
      const rec = r.id ? await recOf(c, String(r.id)) : null;
      if (!rec || rec.section !== op.section || rec.created_by !== c.me.id || new Date(rec.created_at) < new Date(a.confirmed_at)) { allOk = false; errors.push("result not found"); out.push({ op: "create", ok: false, error: "not verified" }); continue; }
      out.push({ op: "create", ok: true, id: rec.id, link: link(rec), title: rec.title }); undos.push({ op: "delete", id: rec.id, section: rec.section, version: rec.version });
    } else if (op.op === "update") {
      const rec = await recOf(c, op.id);
      const same = rec && Object.entries(op.patch || {}).every(([k, v]) => JSON.stringify(rec.data?.[k] ?? null) === JSON.stringify(v ?? null)) && (rec.status ?? null) === (op.status ?? null);
      if (rec && rec.version <= op.version && same && JSON.stringify(op.prev?.fields || {}) === JSON.stringify(op.patch || {}) && (op.prev?.status ?? null) === (op.status ?? null)) { out.push({ op: "update", ok: true, id: rec.id, link: link(rec), title: rec.title, unchanged: true }); continue; } // it already was so: nothing to undo
      if (!rec || rec.version <= op.version || !same) { allOk = false; errors.push("change not found"); out.push({ op: "update", ok: false, error: "not verified" }); continue; }
      out.push({ op: "update", ok: true, id: rec.id, link: link(rec), title: rec.title });
      undos.push({ op: "set", id: rec.id, section: rec.section, version: rec.version, status: op.prev?.status ?? null, fields: op.prev?.fields || {} });
    } else if (op.op === "comment") {
      const { data: cm } = r.comment ? await c.user.from("comments").select("id,record_id,author").eq("id", String(r.comment)).maybeSingle() : await c.user.from("comments").select("id,record_id,author").eq("record_id", op.id).eq("author", c.me.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!cm || cm.record_id !== op.id || cm.author !== c.me.id) { allOk = false; errors.push("comment not found"); out.push({ op: "comment", ok: false, error: "not verified" }); continue; }
      out.push({ op: "comment", ok: true, id: op.id, comment: cm.id, link: link(op) }); noUndo = true; // a posted message is not taken back silently
    }
  }
  const undo = !noUndo && undos.length ? { ops: undos.reverse() } : null;
  const first = out.find((x) => x.ok && x.id);
  await stamp(c, id, { status: allOk ? "executed" : "failed", executed_at: new Date().toISOString(), result_record_id: first?.id || null, result: { ops: out }, undo, error: errors.length ? errors.join("; ").slice(0, 500) : null });
  return { ok: allOk, result: { ops: out, id: first?.id, link: first?.link }, undoable: !!undo, error: errors.length ? errors.join("; ") : undefined };
}

/** Cancel a proposal that was not carried out (the person said no, or the browser could not begin). */
export async function cancel(c: Ctx, id: string) {
  const a = await loadOwn(c, id); if (!a) return { ok: false, status: 404, error: "Not found" };
  if (!["proposed", "needs_clarification"].includes(a.status)) return { ok: false, status: 409, error: `Already ${a.status}` };
  await stamp(c, id, { status: "cancelled" }); return { ok: true };
}

/**
 * Undo, step 1: only an executed action of this person with an exact reversal, and only if nobody changed the
 * records since (version). Returns the reversing operations for the store; step 2 (undone) checks they happened.
 */
export async function undoStart(c: Ctx, id: string) {
  const a = await loadOwn(c, id);
  if (!a) return { ok: false, status: 404, error: "Not found" };
  if (!["executed", "failed"].includes(a.status) || !a.undo) return { ok: false, status: 409, error: T(c.lang, "This action cannot be undone.", "Это действие нельзя отменить.") };
  const ops: Op[] = [];
  for (const u of a.undo.ops || []) {
    const cur = await recOf(c, u.id);
    if (!cur) return { ok: false, status: 409, error: T(c.lang, "The record is no longer there.", "Записи уже нет.") };
    if (cur.version !== u.version) return { ok: false, status: 409, error: T(c.lang, "Someone changed it after this action — nothing was undone.", "После этого действия запись меняли — ничего не отменено.") };
    if (u.op === "delete") { if (cur.created_by !== c.me.id) return { ok: false, status: 403, error: "Not yours to remove" }; ops.push({ op: "delete", id: cur.id, section: cur.section, version: cur.version }); }
    else { const data = { ...(cur.data || {}) }; for (const [k, v] of Object.entries(u.fields || {})) { if (v === null) delete data[k]; else data[k] = v; } ops.push({ op: "update", id: cur.id, section: cur.section, title: cur.title, status: u.status ?? cur.status, data, version: cur.version, patch: u.fields || {} }); }
  }
  return { ok: true, ops };
}
/** Undo, step 2: verified against the database before the audit says "undone". */
export async function undoDone(c: Ctx, id: string) {
  const a = await loadOwn(c, id);
  if (!a || !a.undo) return { ok: false, status: 404, error: "Not found" };
  for (const u of a.undo.ops || []) {
    const cur = await recOf(c, u.id);
    if (u.op === "delete" ? !!cur : !cur || cur.version <= u.version) return { ok: false, status: 409, error: T(c.lang, "The undo did not go through.", "Отмена не прошла.") };
  }
  await stamp(c, id, { status: "undone", undone_at: new Date().toISOString() }); return { ok: true };
}
