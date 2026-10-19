import { adminClient, userClient } from "@/lib/server/supabase";
import { requireUser, limit } from "@/lib/server/authz";
import { isPrivileged } from "@/lib/roles";
import { readState } from "@/lib/server/state";
import { aiUsage, decide, deptFindings, getLog, getQueue, getRules, getSettings, integrations, onRecordEvent, requeue, runAgents, saveRules, saveSettings } from "@/lib/server/automation";
import { AGENTS, DEFAULT_RULES, type AgentId, type Rule } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


/**
 * Automation centre (Administration → System).
 * event {id, kind, from, to}   — any internal user, right after saving a record: runs matching rules (record read with the user's own rights)
 * state                        — owner/admin: settings, rules, queue, agent log, last runs, AI usage, which keys are set
 * settings {settings}          — owner: save company settings
 * rules {rules} | reset_rules  — owner/admin: save rules
 * run {agent?}                 — owner/admin: run one agent or all now
 * decide {id, approve}         — owner/admin: approve or reject a proposal (US-persons-only items need a US person); runs once
 * requeue {id}                 — owner/admin: send a failed or dead item round again
 */
export async function POST(req: Request) {
  const g = await requireUser("internal"); if (g instanceof Response) return g; const me = g.me;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Service key missing", { status: 501 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  try {
    if (b.action === "event") {
      const lim = await limit(`event:${me.id}`, 120, 60, db); if (lim) return lim;
      // Read through the user's own session: the rules run only for records this person can see
      const { data: rec } = await (await userClient()).from("records").select("id,section,title,status,data,controlled,created_by,created_at,updated_at").eq("id", String(b.id || "")).maybeSingle();
      if (!rec) return Response.json({ matched: 0 });
      // the previous status comes from the database's own history, not from the browser
      let from: string | null = b.from ?? null;
      if (b.kind !== "created") { const { data: last } = await db.from("activity").select("detail").eq("record_id", rec.id).eq("action", "status").order("created_at", { ascending: false }).limit(1); if (last?.length) from = last[0].detail?.from ?? null; }
      const ev = b.kind === "created" ? { kind: "created" as const } : { kind: "status" as const, from, to: rec.status };
      if (ev.kind === "status" && (ev.from || "") === (ev.to || "")) return Response.json({ matched: 0 });
      return Response.json(await onRecordEvent(db, rec, ev));
    }
    if (b.action === "targets") return Response.json({ sales_target: (await getSettings(db)).sales_target || 0 });
    if (b.action === "findings") return Response.json(await deptFindings(db, String(b.dept || ""), { role: me.role, us_person: !!me.us_person }));
    const admin = isPrivileged(me.role);
    if (!admin) return new Response("Only owners and administrators", { status: 403 });
    if (b.action === "pending") {
      const q = (await getQueue(db)).filter((x) => x.status === "pending");
      return Response.json({ n: q.length, items: q.slice(0, 8).map((x) => ({ id: x.id, agent: x.agent, title: x.controlled && !me.us_person ? "US-persons-only record" : x.title, at: x.at })) });
    }
    if (b.action === "queue") { // decision centre: pending proposals with what they would do
      const q = (await getQueue(db)).filter((x) => x.status === "pending").slice(0, 60);
      return Response.json(q.map((x) => x.controlled && !me.us_person ? { id: x.id, agent: x.agent, at: x.at, title: "US-persons-only record", detail: "", hidden: true, action: { type: x.action.type } }
        : { id: x.id, agent: x.agent, at: x.at, title: x.title, detail: x.detail, record_id: x.record_id, section: x.section, action: x.action.type === "email" ? { ...x.action, body: String((x.action as any).body || "").slice(0, 1500) } : x.action }));
    }
    if (b.action === "state") {
      const settings = await getSettings(db);
      const [rules, queue, log, agents, quality, brief, usage] = await Promise.all([getRules(db), getQueue(db), getLog(db), readState(db, "agents").catch(() => null), readState(db, "quality").catch(() => null), readState(db, "brief").catch(() => null), aiUsage(db, settings)]);
      // US-persons-only proposals are shown without details to others
      const q = queue.slice(0, 200).map((x) => (x.controlled && !me.us_person ? { ...x, title: "US-persons-only record", detail: "Details hidden", action: { type: x.action.type } } : x));
      return Response.json({ settings, rules, queue: q, log: log.slice(0, 200), agents, quality, brief, usage, integrations: integrations(), owner: me.role === "owner" });
    }
    if (b.action === "settings") { if (me.role !== "owner") return new Response("Only the owner", { status: 403 }); await saveSettings(db, b.settings, me.email); return Response.json({ ok: true, settings: await getSettings(db) }); }
    if (b.action === "rules") {
      const rules = (Array.isArray(b.rules) ? b.rules : []).filter((r: Rule) => r && r.id && r.name && r.section && ["created", "status", "date"].includes(r.on) && Array.isArray(r.actions)).slice(0, 200);
      await saveRules(db, rules, me.email); return Response.json({ ok: true, rules });
    }
    if (b.action === "reset_rules") { await saveRules(db, DEFAULT_RULES, me.email); return Response.json({ ok: true, rules: DEFAULT_RULES }); }
    if (b.action === "run") {
      const only = AGENTS.includes(b.agent) ? (b.agent as AgentId) : undefined;
      const { runJob } = await import("@/lib/server/jobs");
      return Response.json(only ? await runAgents(db, { only, manual: true }) : (await runJob(db, "agents", `manual:${me.email}`, () => runAgents(db, { manual: true }))).result ?? { busy: true });
    }
    if (b.action === "decide") return Response.json(await decide(db, String(b.id || ""), !!b.approve, { id: me.id, us_person: !!me.us_person, email: me.email }, b.edit));
    if (b.action === "requeue") return Response.json(await requeue(db, String(b.id || ""), me.email));
  } catch (e: any) { return new Response(e?.message || "Failed", { status: 500 }); }
  return new Response("Unknown action", { status: 400 });
}
