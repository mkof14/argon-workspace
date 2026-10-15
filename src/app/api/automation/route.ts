import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { readState } from "@/lib/server/backup";
import { aiUsage, decide, deptFindings, getLog, getQueue, getRules, getSettings, integrations, onRecordEvent, runAgents, saveRules, saveSettings } from "@/lib/server/automation";
import { AGENTS, DEFAULT_RULES, type AgentId, type Rule } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];

/**
 * Automation centre (Administration → System).
 * event {id, kind, from, to}   — any internal user, right after saving a record: runs matching rules (record read with the user's own rights)
 * state                        — owner/admin: settings, rules, queue, agent log, last runs, AI usage, which keys are set
 * settings {settings}          — owner: save company settings
 * rules {rules} | reset_rules  — owner/admin: save rules
 * run {agent?}                 — owner/admin: run one agent or all now
 * decide {id, approve}         — owner/admin: approve or reject a proposal (US-persons-only items need a US person)
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Service key missing", { status: 501 });
  const b = await req.json().catch(() => ({}));
  const db = adminClient();
  try {
    if (b.action === "event") {
      // Read through the user's own session: the rules run only for records this person can see
      const { data: rec } = await (await userClient()).from("records").select("id,section,title,status,data,controlled,created_by,created_at,updated_at").eq("id", String(b.id || "")).maybeSingle();
      if (!rec) return Response.json({ matched: 0 });
      const ev = b.kind === "created" ? { kind: "created" as const } : { kind: "status" as const, from: b.from ?? null, to: rec.status };
      if (ev.kind === "status" && (ev.from || "") === (ev.to || "")) return Response.json({ matched: 0 });
      return Response.json(await onRecordEvent(db, rec, ev));
    }
    if (b.action === "findings") return Response.json(await deptFindings(db, String(b.dept || ""), { role: me.role, us_person: !!me.us_person }));
    const admin = ["owner", "admin"].includes(me.role);
    if (!admin) return new Response("Only owners and administrators", { status: 403 });
    if (b.action === "pending") {
      const q = (await getQueue(db)).filter((x) => x.status === "pending");
      return Response.json({ n: q.length, items: q.slice(0, 8).map((x) => ({ id: x.id, agent: x.agent, title: x.controlled && !me.us_person ? "US-persons-only record" : x.title, at: x.at })) });
    }
    if (b.action === "state") {
      const settings = await getSettings(db);
      const [rules, queue, log, agents, quality, brief, usage] = await Promise.all([getRules(db), getQueue(db), getLog(db), readState(db, "agents").catch(() => null), readState(db, "quality").catch(() => null), readState(db, "brief").catch(() => null), aiUsage(db, settings)]);
      // US-persons-only proposals are shown without details to others
      const q = queue.slice(0, 200).map((x) => (x.controlled && !me.us_person ? { ...x, title: "US-persons-only record", detail: "Details hidden", action: { type: x.action.type } } : x));
      return Response.json({ settings, rules, queue: q, log: log.slice(0, 200), agents, quality, brief, usage, integrations: integrations(), owner: me.role === "owner" });
    }
    if (b.action === "settings") { if (me.role !== "owner") return new Response("Only the owner", { status: 403 }); await saveSettings(db, b.settings); return Response.json({ ok: true, settings: await getSettings(db) }); }
    if (b.action === "rules") {
      const rules = (Array.isArray(b.rules) ? b.rules : []).filter((r: Rule) => r && r.id && r.name && r.section && ["created", "status", "date"].includes(r.on) && Array.isArray(r.actions)).slice(0, 200);
      await saveRules(db, rules); return Response.json({ ok: true, rules });
    }
    if (b.action === "reset_rules") { await saveRules(db, DEFAULT_RULES); return Response.json({ ok: true, rules: DEFAULT_RULES }); }
    if (b.action === "run") {
      const only = AGENTS.includes(b.agent) ? (b.agent as AgentId) : undefined;
      return Response.json(await runAgents(db, { only, manual: true }));
    }
    if (b.action === "decide") return Response.json(await decide(db, String(b.id || ""), !!b.approve, { id: me.id, us_person: !!me.us_person, email: me.email }, b.edit));
  } catch (e: any) { return new Response(e?.message || "Failed", { status: 500 }); }
  return new Response("Unknown action", { status: 400 });
}
