import { adminClient, userClient } from "@/lib/server/supabase";
import { limit, requireUser } from "@/lib/server/authz";
import { cancel, complete, plan, start, undoDone, undoStart, type Ctx } from "@/lib/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice Inbox and voice / typed commands (Phase 5). Internal staff only (externals: 403). Transcription happens in
 * the browser (the device's own speech recognition); only the text comes here. Every proposal, confirmation,
 * result and undo is kept in action_audit; the inbox keeps the original words.
 *   capture  {text, source, lang}         → inbox item + proposal (nothing changes yet)
 *   plan     {text, lang}                 → proposal for a direct command
 *   start    {id, confirm, personId?, taskId?} → begin a stored proposal (writes need confirm: true); returns the
 *            record operations, which the browser carries out through the ordinary store (one business-logic path)
 *   complete {id, results}                → the results, checked against the database, go into the audit
 *   cancel   {id}                         → the person said no
 *   undo     {id} → reversing operations (exact only) · undone {id} → checked, then the audit says "undone"
 *   convert  {inbox, as, title?, date?, personId?, project?} → a new proposal from an inbox item (task / reminder /
 *            note / follow-up / project item), begun with the person's confirmation
 *   dismiss  {inbox} · inbox {} · audit {}
 */
export async function POST(req: Request) {
  const u = await requireUser("internal"); if (u instanceof Response) return u;
  { const lim = await limit(`voice:${u.me.id}`, 60, 60); if (lim) return lim; }
  const b = await req.json().catch(() => ({}));
  const db = adminClient(); const c: Ctx = { user: await userClient(), admin: db, me: u.me, lang: String(b.lang || u.me.lang || "en") };
  const text = String(b.text || "").trim().slice(0, 2000);
  const inbox = async (id: string) => (await db.from("voice_inbox").select("*").eq("id", id).eq("user_id", u.me.id).maybeSingle()).data;
  const markInbox = async (actionId: string, rec: string | null) => { await db.from("voice_inbox").update({ status: "Converted", result_record_id: rec, updated_at: new Date().toISOString() }).eq("action_id", actionId).eq("user_id", u.me.id); };
  const inboxStatus = (p: Awaited<ReturnType<typeof plan>>) => p.status === "rejected" ? "Failed" : p.status === "needs_clarification" ? "Needs Confirmation" : p.risk === "read" ? "Parsed" : "Needs Confirmation";
  try {
    switch (b.action) {
      case "plan": { if (!text) return new Response("Say or type what to do", { status: 400 }); return Response.json(await plan(c, text, b.source === "voice" ? "voice" : "text")); }
      case "capture": {
        if (!text) return new Response("Nothing was captured", { status: 400 });
        const { data: it, error } = await db.from("voice_inbox").insert({ user_id: u.me.id, raw_text: text, source: b.source === "text" ? "text" : "voice", lang: ["en", "ru", "uk", "ar"].includes(b.lang) ? b.lang : null }).select("*").single();
        if (error) throw error;
        try {
          const p = await plan(c, text, "voice_inbox");
          await db.from("voice_inbox").update({ status: inboxStatus(p), plan: p, question: p.question || null, action_id: p.id, updated_at: new Date().toISOString() }).eq("id", it.id);
          return Response.json({ item: { ...it, status: inboxStatus(p), plan: p, question: p.question || null, action_id: p.id }, plan: p });
        } catch (e: any) {
          await db.from("voice_inbox").update({ status: "Failed", error: String(e?.message || e).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", it.id);
          return Response.json({ item: { ...it, status: "Failed", error: String(e?.message || e) } });
        }
      }
      case "start": { const r = await start(c, String(b.id || ""), { confirm: b.confirm === true, personId: b.personId, taskId: b.taskId }); if (r.ok && (r as any).note) await markInbox(String(b.id), null); return Response.json(r, { status: r.ok ? 200 : (r as any).status || 400 }); }
      case "complete": {
        const r = await complete(c, String(b.id || ""), Array.isArray(b.results) ? b.results.slice(0, 20) : []);
        if (r.ok) await markInbox(String(b.id), (r as any).result?.id || null);
        return Response.json(r, { status: r.ok ? 200 : (r as any).status || 400 });
      }
      case "cancel": { const r = await cancel(c, String(b.id || "")); return Response.json(r, { status: r.ok ? 200 : (r as any).status || 400 }); }
      case "undo": { const r = await undoStart(c, String(b.id || "")); return Response.json(r, { status: r.ok ? 200 : (r as any).status || 400 }); }
      case "undone": { const r = await undoDone(c, String(b.id || "")); return Response.json(r, { status: r.ok ? 200 : (r as any).status || 400 }); }
      case "convert": {
        const it = await inbox(String(b.inbox || "")); if (!it) return new Response("Not found", { status: 404 });
        if (["Converted", "Dismissed"].includes(it.status)) return new Response(`Already ${it.status}`, { status: 409 });
        const title = String(b.title || it.plan?.slots?.title || it.raw_text).trim().slice(0, 200);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : it.plan?.slots?.date;
        const as = ["task", "reminder", "note", "followup", "project"].includes(String(b.as)) ? String(b.as) : "task";
        // the person, the project: re-read under the person's rights
        let person: any = null; let project: any = null;
        if (b.personId && b.personId !== u.me.id) { const { data: p } = await c.user.from("profiles").select("id,full_name,email,role,disabled").eq("id", String(b.personId)).maybeSingle(); if (!p || p.disabled || ["partner", "vendor", "investor", "pending"].includes(p.role)) return new Response("Unknown person", { status: 400 }); person = { id: p.id, name: p.full_name || p.email }; }
        if (as === "project") { const { data: pr } = await c.user.from("records").select("id,title,section").eq("id", String(b.project || "")).maybeSingle(); if (!pr || pr.section !== "company.projects") return new Response("Choose a project", { status: 400 }); project = { id: pr.id, title: pr.title }; }
        const kind = as === "reminder" ? "create_reminder" : as === "note" ? "note" : "create_task";
        // the person's explicit choice of what this becomes is stored as a new proposal, then begun with this click
        const { data: a, error } = await db.from("action_audit").insert({ user_id: u.me.id, source: "voice_inbox", command: it.raw_text, intent: kind, risk: person ? "material" : "low",
          interpreted: { intent: kind, slots: { title, date }, resolved: person ? { person } : {}, project, from_inbox: it.id, as }, status: "proposed" }).select("id").single();
        if (error) throw error;
        await db.from("voice_inbox").update({ action_id: a.id, converted_as: as, updated_at: new Date().toISOString() }).eq("id", it.id);
        const r = await start(c, a.id, { confirm: b.confirm === true });
        if (r.ok && (r as any).note) await markInbox(a.id, null);
        return Response.json({ ...r, action_id: a.id }, { status: r.ok ? 200 : (r as any).status || 400 });
      }
      case "crm_propose": {
        // Phase 7: a follow-up for an opportunity — proposed, then done only with the person's explicit yes. The opportunity
        // is re-read under the person's own rights; a draft message is text only and is never sent from here.
        const { data: opp } = await c.user.from("records").select("id,title,section,data").eq("id", String(b.opp || "")).maybeSingle();
        if (!opp || opp.section !== "sales.pipeline") return new Response("Opportunity not found", { status: 404 });
        const label = (opp.data?.number ? opp.data.number + " · " : "") + opp.title;
        const kind = String(b.kind || "task");
        if (kind === "draft") {
          const who = String(b.to || opp.data?.contact || "").trim();
          const text = (c.lang === "ru" ? `Здравствуйте${who ? ", " + who : ""}!\n\nСпасибо за время и интерес к ${opp.title}. Предлагаю следующий шаг: ${String(b.title || "короткий звонок для уточнения требований")}.\nКогда вам удобно?\n\nС уважением,\n${u.me.full_name || ""}`
            : `Hello${who ? " " + who : ""},\n\nThank you for your time and interest in ${opp.title}. As a next step I suggest: ${String(b.title || "a short call to clarify your requirements")}.\nWhat time would suit you?\n\nBest regards,\n${u.me.full_name || ""}`);
          return Response.json({ ok: true, draft: text, sent: false, note: "Draft only — nothing is sent. Copy it into your own e-mail after review." });
        }
        if (!["task", "reminder", "note", "followup"].includes(kind)) return new Response("Unknown kind", { status: 400 });
        const title = String(b.title || "").trim().slice(0, 200); if (!title) return new Response("Title required", { status: 400 });
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : undefined;
        const intent = kind === "reminder" ? "create_reminder" : kind === "note" ? "note" : "create_task";
        const { data: a, error } = await db.from("action_audit").insert({ user_id: u.me.id, source: "crm", command: `${kind}: ${title} — ${label}`, intent, risk: "low",
          interpreted: { intent, slots: { title, date }, resolved: {}, deal: { id: opp.id, title: label }, as: kind }, status: "proposed" }).select("id").single();
        if (error) throw error;
        const r = await start(c, a.id, { confirm: b.confirm === true });
        return Response.json({ ...r, action_id: a.id }, { status: r.ok ? 200 : (r as any).status || 400 });
      }
      case "dismiss": {
        const it = await inbox(String(b.inbox || "")); if (!it) return new Response("Not found", { status: 404 });
        await db.from("voice_inbox").update({ status: "Dismissed", updated_at: new Date().toISOString() }).eq("id", it.id);
        if (it.action_id) await db.from("action_audit").update({ status: "cancelled" }).eq("id", it.action_id).eq("user_id", u.me.id).in("status", ["proposed", "needs_clarification"]);
        return Response.json({ ok: true });
      }
      case "inbox": { const { data } = await c.user.from("voice_inbox").select("*").order("created_at", { ascending: false }).limit(100); return Response.json(data || []); }
      case "audit": { const { data } = await c.user.from("action_audit").select("id,created_at,source,command,intent,risk,status,question,error,confirmed_at,executed_at,result,result_record_id,undo,undone_at").eq("user_id", u.me.id).order("created_at", { ascending: false }).limit(50); return Response.json((data || []).map((x: any) => ({ ...x, undoable: ["executed", "failed"].includes(x.status) && !!x.undo, undo: undefined }))); }
      default: return new Response("Unknown action", { status: 400 });
    }
  } catch (e: any) { return new Response(String(e?.message || e), { status: e?.status || 500 }); }
}
