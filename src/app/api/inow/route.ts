import { adminClient, userClient } from "@/lib/server/supabase";
import { limit, requireUser } from "@/lib/server/authz";
import { changes, endOfDay, executive, meetingBrief, myDay } from "@/lib/server/inow";
import { plan, type Ctx } from "@/lib/server/actions";
import { askIntent, why, type Ranked } from "@/lib/inow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 1inow (P10) — the personal intelligence layer. Internal staff only; every read runs WITH THE PERSON'S OWN CLIENT, so
 * row-level security and the engines' reading rule decide what exists for them (a hidden record adds nothing).
 *   GET ?view=day | executive (owner/management) | changes&window=day|week | eod | meeting&id= | settings
 *   POST {op: "ask", q, context?}       deterministic answer from records (with sources), an action proposal
 *                                       (preview → confirm through the existing safe-action layer), or {assistant}
 *   POST {op: "state", key, pin|snooze|dismiss|not_relevant|remind|clear}   personal state of one My Day item
 *   POST {op: "commitment", id, decision: "confirm" | "dismiss"}            a detected commitment → proposal / gone
 *   POST {op: "touch", record}          recent working context (convenience only; access is checked again)
 *   POST {op: "prefs", home, smart_notifications} · {op: "settings", flags, home} (owners/administrators)
 * Failures are local: a failing engine marks its own section unavailable; AI being off never breaks My Day.
 */
const MGMT = ["owner", "admin", "management"];
const json = (b: unknown, s = 200) => Response.json(b, { status: s, headers: { "Cache-Control": "no-store" } });
async function flags(sb: any) { const { data } = await sb.from("inow_settings").select("flags,home").maybeSingle(); return { flags: data?.flags || {}, home: data?.home || {} }; }
const metric = (sb: any, name: string, n = 1) => sb.rpc("inow_metric", { p_name: name, p_n: n }).then(() => null, () => null);

export async function GET(req: Request) {
  const u = await requireUser("internal"); if (u instanceof Response) return u;
  const sb = await userClient(); const q = new URL(req.url).searchParams; const view = q.get("view") || "day";
  const f = await flags(sb);
  if (view === "settings") { const { data: p } = await sb.from("inow_prefs").select("home,smart_notifications").eq("user_id", u.me.id).maybeSingle(); return json({ ...f, prefs: p || null, role: u.me.role }); }
  if (f.flags.my_day === false) return json({ disabled: true, ...f }, 200);
  try {
    if (view === "day") {
      const d = await myDay(sb, u.me); metric(sb, "my_day"); if (d.ms > 1000) metric(sb, "my_day_slow");
      return json({ ...d, flags: f.flags, executive_available: MGMT.includes(u.me.role) && f.flags.executive !== false });
    }
    if (view === "executive") {
      if (!MGMT.includes(u.me.role) || f.flags.executive === false) return json({ error: "Executive 1inow is for owners and management" }, 403);
      metric(sb, "executive"); return json(await executive(sb, u.me));
    }
    if (view === "changes") return json(await changes(sb, u.me, q.get("window") === "week" ? "week" : "day"));
    if (view === "eod") return json(await endOfDay(sb, u.me));
    if (view === "meeting") { const b = await meetingBrief(sb, u.me, String(q.get("id") || "")); return b ? json(b) : json({ error: "Not found" }, 404); }
    return json({ error: "unknown view" }, 400);
  } catch { return json({ error: "1inow is temporarily unavailable" }, 500); } // never an internal detail (no record, no SQL text)
}

export async function POST(req: Request) {
  const u = await requireUser("internal"); if (u instanceof Response) return u;
  { const lim = await limit(`inow:${u.me.id}`, 120, 60); if (lim) return lim; }
  const sb = await userClient(); const b = await req.json().catch(() => ({})); const f = await flags(sb);
  switch (b.op) {
    case "ask": {
      if (f.flags.ask === false) return json({ disabled: true });
      const text = String(b.q || "").trim().slice(0, 500); if (!text) return json({ error: "Ask something" }, 400);
      metric(sb, "ask");
      return json(await ask(sb, u.me, text, b.context ? String(b.context) : null, String(b.lang || u.me.lang || "en"), b.choice ? String(b.choice) : null));
    }
    case "state": {
      const key = String(b.key || "").slice(0, 200); if (key.length < 3) return json({ error: "no item" }, 400);
      const now = new Date(); const row: any = { user_id: u.me.id, item_key: key, updated_at: now.toISOString() };
      if (b.clear) { await sb.from("inow_item_state").delete().eq("user_id", u.me.id).eq("item_key", key); return json({ ok: true, undo: null }); }
      const { data: prev } = await sb.from("inow_item_state").select("*").eq("user_id", u.me.id).eq("item_key", key).maybeSingle();
      if (typeof b.pin === "boolean") { row.pinned = b.pin; metric(sb, "item_pinned"); }
      if (b.snooze) { row.snooze_until = snoozeUntil(String(b.snooze), now, u.me.timezone); metric(sb, "item_snoozed"); }
      if (b.dismiss) { row.dismissed_at = now.toISOString(); metric(sb, "suggestion_dismissed"); }
      if (b.not_relevant) { row.not_relevant = true; metric(sb, "suggestion_dismissed"); }
      if (b.remind) row.remind_at = snoozeUntil(String(b.remind), now, u.me.timezone);
      const { error } = await sb.from("inow_item_state").upsert({ ...(prev || {}), ...row }, { onConflict: "user_id,item_key" });
      if (error) return json({ error: "Could not save" }, 400);
      // personal state is exactly reversible: the previous row (or none) is the undo
      return json({ ok: true, undo: { op: "state_restore", key, prev: prev || null } });
    }
    case "state_restore": {
      const key = String(b.key || ""); if (!b.prev) await sb.from("inow_item_state").delete().eq("user_id", u.me.id).eq("item_key", key);
      else await sb.from("inow_item_state").upsert({ ...b.prev, user_id: u.me.id, item_key: key }, { onConflict: "user_id,item_key" });
      return json({ ok: true });
    }
    case "commitment": {
      const { data: c } = await sb.from("inow_commitments").select("*").eq("id", String(b.id || "")).maybeSingle();
      if (!c || c.status !== "suggested") return json({ error: "This commitment was already handled" }, 409); // no double conversion
      if (b.decision === "dismiss") { await sb.from("inow_commitments").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", c.id).eq("status", "suggested"); metric(sb, "commitment_dismissed"); return json({ ok: true }); }
      // confirm: a task proposal through the safe-action layer (the person confirms it there; the audit keeps it)
      // claim it first (conditional update): of two simultaneous confirmations exactly one makes a proposal
      const { data: claimed } = await sb.from("inow_commitments").update({ status: "confirmed", decided_at: new Date().toISOString() }).eq("id", c.id).eq("status", "suggested").select("id");
      if (!claimed?.length) return json({ error: "This commitment was already handled" }, 409);
      const ctx: Ctx = { user: sb, admin: adminClient(), me: u.me, lang: String(b.lang || "en") };
      const p = await plan(ctx, `create task ${c.excerpt.slice(0, 140)}${c.due ? ` by ${c.due}` : ""}`, "assistant");
      metric(sb, "commitment_confirmed"); metric(sb, "action_proposed");
      return json({ ok: true, proposal: p });
    }
    case "touch": { if (b.record) await sb.rpc("inow_touch", { p_record: String(b.record) }); return json({ ok: true }); }
    case "prefs": {
      const row: any = { user_id: u.me.id, updated_at: new Date().toISOString() };
      if (b.home === "today" || b.home === "inow") row.home = b.home; if (typeof b.smart_notifications === "boolean") row.smart_notifications = b.smart_notifications;
      const { error } = await sb.from("inow_prefs").upsert(row, { onConflict: "user_id" }); return error ? json({ error: "Could not save" }, 400) : json({ ok: true });
    }
    case "settings": {
      const { error } = await sb.rpc("inow_settings_save", { p_flags: b.flags || null, p_home: b.home || null });
      return error ? json({ error: error.code === "42501" ? "Only an owner or administrator changes 1inow settings" : "Could not save" }, error.code === "42501" ? 403 : 400) : json({ ok: true });
    }
    default: return json({ error: "unknown operation" }, 400);
  }
}

/** "tomorrow" | "next_week" | "later" (3 h) | "1h" | an ISO time — in the person's own time zone where it matters. */
function snoozeUntil(v: string, now: Date, tz?: string | null) {
  const at9 = (days: number) => { const d = new Date(now.getTime() + days * 864e5); const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d); return new Date(`${day}T09:00:00Z`).toISOString(); };
  if (v === "tomorrow") return at9(1); if (v === "next_week") return at9(7); if (v === "1h") return new Date(now.getTime() + 36e5).toISOString(); if (v === "later") return new Date(now.getTime() + 3 * 36e5).toISOString();
  const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : new Date(now.getTime() + 3 * 36e5).toISOString();
}

const line = (r: Ranked, lang: string) => ({ title: r.title, link: r.link, why: why(r, (["en", "ru", "uk", "ar"].includes(lang) ? lang : "en") as any), priority: r.priority, key: r.key });
const WRITE = /^\s*(?:please\s+|пожалуйста,?\s+|будь ласка,?\s+)?(create|add|make|assign|remind|schedule|move|reschedule|complete|mark|создай|создать|добавь|назначь|напомни|перенеси|отметь|заверши|створи|додай|признач|нагадай|перенеси|познач)(?![\p{L}])/iu;

/**
 * Ask 1inow. Order: (1) a request to DO something → a proposal from the safe-action layer (preview; nothing changes
 * until the person confirms); (2) a question the records answer → a deterministic answer with its sources;
 * (3) anything else → {assistant: true}: the page asks the hardened Workspace Assistant (same retrieval rules).
 */
async function ask(sb: any, me: any, text: string, context: string | null, lang: string, choice: string | null = null) {
  if (!choice && WRITE.test(text)) {
    const ctx: Ctx = { user: sb, admin: adminClient(), me, lang };
    try {
      const p = await plan(ctx, text, "assistant"); metric(sb, "command");
      if (p.status === "needs_clarification") metric(sb, "entity_ambiguous"); else if (p.status === "proposed") metric(sb, "action_proposed");
      return { kind: "proposal", proposal: p };
    } catch { metric(sb, "command_failure"); return { kind: "error", text: "The request could not be prepared. Nothing was changed." }; }
  }
  const { intent, subject: s0 } = askIntent(text);
  // context is a convenience: a record id from the page, accepted only if the person can open it
  let subject = s0;
  if (!subject && context && /\b(it|this|that|его|это|этого|цього|це|його)\b/i.test(text)) {
    const { data: r } = await sb.from("records").select("id,title,section,data").eq("id", context).maybeSingle();
    if (r) subject = r.data?.number || r.title;
  }
  if (intent === "unknown") { metric(sb, "ask_ai"); return { kind: "assistant", text }; }
  metric(sb, "ask_deterministic");
  const sources = (rs: Ranked[]) => rs.map((r) => ({ title: r.title, link: r.link }));
  if (intent === "changes") {
    const c = await changes(sb, me, /week|недел|тиж/i.test(text) ? "week" : "day");
    return { kind: "answer", intent, items: c.items.slice(0, 10).map((x: any) => ({ title: x.title, link: x.link, why: `${x.kind} · ${String(x.at).slice(0, 16).replace("T", " ")}` })), sources: c.items.slice(0, 10).map((x: any) => ({ title: x.title, link: x.link })), total: c.total };
  }
  if (intent === "project" || intent === "blockers") {
    // resolve the subject among the person's own projects and build units; more than one different match → ask
    const like = `%${String(subject).replace(/[%_]/g, "")}%`;
    const [{ data: ps }, { data: us }, { data: os }] = await Promise.all([
      sb.from("records").select("id,title,section,status,data").eq("section", "company.projects").ilike("title", like).limit(5),
      sb.from("records").select("id,title,section,status,data").eq("section", "operations.builds").or(`title.ilike.${like},data->>number.ilike.${like}`).limit(5),
      sb.from("records").select("id,title,section,status,data").in("section", ["company.parties", "operations.vendors"]).ilike("title", like).limit(5),
    ]);
    let all = [...(ps || []), ...(us || []), ...(os || [])];
    if (choice) { // the person picked one of the offered matches: re-read it with their own rights (never trust the id alone)
      const { data: picked } = await sb.from("records").select("id,title,section,status,data").eq("id", choice).in("section", ["company.projects", "operations.builds", "company.parties", "operations.vendors"]).maybeSingle();
      all = picked ? [picked] : [];
    }
    if (!all.length) return { kind: "answer", intent, items: [], sources: [], note: "nothing_found" };
    const exact = all.length === 1 ? all : all.filter((r: any) => String(r.data?.number || r.title).toLowerCase() === String(subject).toLowerCase());
    if (all.length > 1 && exact.length !== 1) { metric(sb, "entity_ambiguous"); return { kind: "choose", intent, options: all.map((r: any) => ({ id: r.id, label: `${r.data?.number ? r.data.number + " — " : ""}${r.title}`, section: r.section })) }; }
    const r: any = exact[0] || all[0];
    if (r.section === "operations.builds") {
      const { data: a } = await sb.rpc("mfg_assistant", { p_intent: intent === "blockers" ? "blocking" : "status", p_arg: r.data?.number || r.title });
      return { kind: "answer", intent, subject: { id: r.id, title: r.title, link: `/operations/builds?r=${r.id}` }, facts: a || null, sources: [{ title: r.title, link: `/operations/builds?r=${r.id}` }] };
    }
    if (r.section === "company.parties" || r.section === "operations.vendors") {
      // an organisation: what I wait for from it and what it waits for from me — from the waiting-for engine, my rights
      const { data: w } = await sb.rpc("waiting_for");
      const name = String(r.title).toLowerCase();
      const rows = ((w as any[]) || []).filter((x) => x.party_id === r.id || String(x.party_name || "").toLowerCase() === name).slice(0, 10);
      const link = `/${r.section.replace(".", "/")}?r=${r.id}`;
      return { kind: "answer", intent, subject: { id: r.id, title: r.title, link }, items: rows.map((x: any) => ({ title: x.title, link: x.link, why: [x.bucket === "me" ? "waiting for you" : "you are waiting", x.age_days != null ? `${x.age_days} d` : null, x.escalation].filter(Boolean).join(" · ") })),
        sources: [{ title: r.title, link }, ...rows.map((x: any) => ({ title: x.title, link: x.link }))] };
    }
    const [{ data: h }, { data: l }] = await Promise.all([sb.rpc("project_health", { p_project: r.id }), sb.rpc("open_loops", { p_project: r.id })]);
    const hh: any = (h || [])[0] || null;
    return { kind: "answer", intent, subject: { id: r.id, title: r.title, link: `/company/projects?r=${r.id}` }, health: hh ? { level: hh.level, reasons: hh.reasons, next_milestone: hh.next_milestone } : null,
      items: (l || []).slice(0, 8).map((x: any) => ({ title: x.title, link: x.link, why: x.next_action })), sources: [{ title: r.title, link: `/company/projects?r=${r.id}` }, ...(l || []).slice(0, 8).map((x: any) => ({ title: x.title, link: x.link }))] };
  }
  const d = await myDay(sb, me);
  const all = [...d.now, ...d.decisions, ...d.today, ...d.attention, ...d.waiting, ...d.loops];
  const pick: Record<string, Ranked[]> = {
    attention: [...d.now, ...d.attention], important: d.now.length ? d.now : all.slice(0, 3), today: [...d.now, ...d.today], waiting_me: all.filter((r) => r.signals.some((s) => s.code === "blocks_others") || r.src === "approval" || r.src === "workflow"),
    waiting_others: d.waiting, stalled: all.filter((r) => r.signals.some((s) => s.code === "stalled" || s.code === "blocked")), approvals: all.filter((r) => r.src === "approval"),
    decisions: d.decisions, followups: all.filter((r) => r.src === "followup" || r.src === "lead" || r.signals.some((s) => s.code === "commercial_followup")),
    proposals_no_response: all.filter((r) => r.src === "followup" && r.signals.some((s) => s.code === "customer_waiting" || s.code === "no_followup")),
    vendors_late: d.waiting.filter((r) => r.signals.some((s) => s.code === "vendor_waiting")), open_loops: d.loops, promises: all.filter((r) => r.src === "commitment"),
    next: d.next.map((n) => n.item),
  };
  const rs = (pick[intent] || []).slice(0, 10);
  return { kind: "answer", intent, items: rs.map((r) => line(r, lang)), sources: sources(rs), next: intent === "next" ? d.next.map((n) => ({ title: n.item.title, link: n.item.link, required: n.required, suggested: n.suggested.map((x) => x.label) })) : undefined, sections: d.counts };
}
