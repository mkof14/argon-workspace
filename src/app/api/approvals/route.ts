import { hashToken, newToken } from "@/lib/server/tokens";
import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { limit, clientIp } from "@/lib/server/authz";
import { reportError } from "@/lib/server/errors";
import { sendMail } from "@/lib/server/mailer";
import { localizeMail } from "@/lib/server/translate";
import { PUSH, pushTo } from "@/lib/server/push";
import { renderEmail, plainText, COMPANY, SITE } from "@/lib/mail";
import { APPROVALS, approvalNeeds, limitRoles, withLimits } from "@/config/approvals";
import { getSettings } from "@/lib/server/automation";
import { allSections } from "@/config/workspace.config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click approvals.
 *  approvers {record_id}             → people who may approve this record
 *  request   {record_id, approver_id, note} → creates the request and emails the approver
 *  cancel    {id}                    → the requester withdraws a pending request
 *  view      {token}                 → details for the confirm page (no sign-in needed: the email link is the key)
 *  decide    {token | id, decision, comment} → approve or reject; updates the record and emails the requester
 */
const SECS: any[] = allSections() as any[];
const sec = (id: string) => SECS.find((s) => s.id === id);
const fmt = (f: any, v: any) => (v == null || v === "" ? "" : f?.type === "money" || f?.type === "number" ? Number(v).toLocaleString("en-US") : String(v).length > 1500 ? String(v).slice(0, 1500) + "…" : String(v));
const L = (lang: string, en: string, ru: string) => (lang === "ru" || lang === "uk" ? ru : en);


function details(r: any) {
  const s = sec(r.section); const rule = APPROVALS[r.section];
  return (rule?.key || []).map((k) => { const f = s?.fields.find((x: any) => x.key === k); const v = fmt(f, r.data?.[k]); return v ? { label: f?.label?.en || k, label_ru: f?.label?.ru || f?.label?.en || k, value: v } : null; }).filter(Boolean) as any[];
}

async function approversFor(db: any, r: any, exclude: string) {
  const rule = APPROVALS[r.section]; if (!rule) return [];
  // Spending: only the roles whose limit covers this amount (Administration → System → Settings → Approval limits)
  const lim = limitRoles(r.section, r.data || {}, withLimits((await getSettings(db)).limits));
  const { data } = await db.from("profiles").select("id,full_name,email,role,us_person,lang").in("role", lim || rule.approvers).neq("id", exclude);
  return (data || []).filter((p: any) => !r.controlled || p.us_person);
}

async function decide(db: any, a: any, decision: "approved" | "rejected", comment: string, by: any) {
  const { data: r } = await db.from("records").select("*").eq("id", a.record_id).single();
  if (!r) return "Record not found";
  const rule = APPROVALS[r.section];
  // checked again now, not only when the link was sent: the approver must still be allowed to decide
  const { data: ap } = await db.from("profiles").select("id,role,us_person,disabled").eq("id", a.approver_id).maybeSingle();
  const lim = rule ? limitRoles(r.section, r.data || {}, withLimits((await getSettings(db)).limits)) : null;
  if (!ap || ap.disabled || !rule || !(lim || rule.approvers).includes(ap.role) || (r.controlled && !ap.us_person)) return "The approver is no longer allowed to decide this request";
  const now = new Date().toISOString();
  const { data: upd } = await db.from("approvals").update({ status: decision, comment: comment || null, decided_at: now }).eq("id", a.id).eq("status", "pending").select("id");
  if (!upd?.length) return "This request was already decided";
  const status = decision === "approved" ? rule?.ok : rule?.no;
  if (status) await db.from("records").update({ status }).eq("id", r.id);
  const who = by.full_name || by.email;
  await db.from("comments").insert({ record_id: r.id, author: by.id, body: `${decision === "approved" ? "✓ Approved" : "✗ Rejected"} by ${who}${comment ? `: ${comment}` : ""}` });
  const { data: req } = await db.from("profiles").select("email,full_name,lang").eq("id", a.requested_by).single();
  if (req?.email) {
    const lang = req.lang === "ru" ? "ru" : "en"; const s = sec(r.section);
    const ok = decision === "approved";
    const subject = `${ok ? L(lang, "Approved", "Согласовано") : L(lang, "Rejected", "Отклонено")}: ${r.title}`;
    const body = `${L(lang, `${who} ${ok ? "approved" : "rejected"} your request.`, `${who} ${ok ? "согласовал(а)" : "отклонил(а)"} ваш запрос.`)}\n\n**${r.title}** · ${s?.label?.[lang] || s?.label?.en}${comment ? `\n\n${L(lang, "Comment", "Комментарий")}: ${comment}` : ""}`;
    const cta = { label: L(lang, "Open in Workspace", "Открыть в Workspace"), url: `${SITE}/${r.section.replace(".", "/")}?r=${r.id}` };
    // Ukrainian and Arabic readers get the same letter translated
    const m = ["uk", "ar"].includes(req.lang) ? await localizeMail(db, req.lang, { subject, body, text: cta.label }) : { subject, body, text: cta.label };
    const ml = (["uk", "ar"].includes(req.lang) ? req.lang : lang) as any; const c2 = { ...cta, label: m.text };
    await sendMail({ to: req.email, subject: m.subject, html: renderEmail({ subject: m.subject, heading: m.subject, body: m.body!, cta: c2, lang: ml, sender: COMPANY }), text: plainText({ body: m.body!, cta: c2, sender: COMPANY, lang: ml }) });
  }
  await pushTo(db, [a.requested_by], (l) => ({ title: PUSH.decided_t[l], body: `${r.controlled ? "US-persons-only record" : r.title} — ${(decision === "approved" ? PUSH.approved : PUSH.rejected)[l]} (${who})`, url: `/${r.section.replace(".", "/")}?r=${r.id}`, tag: `ap-${a.id}` })).catch((e) => reportError(db, "approvals:push", e));
  return null;
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const db = adminClient();

  // Token actions work from the email link without signing in
  if (b.action === "view" || (b.action === "decide" && b.token)) {
    const lim = await limit(`approve:${clientIp(req)}`, 30, 60, db); if (lim) return lim;
    const token = String(b.token || "");
    if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) return new Response("Link is not valid", { status: 404 });
    const { data: a } = await db.from("approvals").select("*").eq("token_hash", hashToken(token)).maybeSingle();
    if (!a) return new Response("Link is not valid", { status: 404 });
    if (a.status === "pending" && Date.parse(a.expires_at) < Date.now()) { await db.from("approvals").update({ status: "expired" }).eq("id", a.id); a.status = "expired"; }
    const [{ data: r }, { data: rq }, { data: ap }] = await Promise.all([
      db.from("records").select("*").eq("id", a.record_id).single(),
      db.from("profiles").select("full_name,email").eq("id", a.requested_by).single(),
      db.from("profiles").select("id,full_name,email,role,lang").eq("id", a.approver_id).single(),
    ]);
    if (!r) return new Response("Record not found", { status: 404 });
    if (b.action === "decide") {
      if (a.status !== "pending") return new Response(`Already ${a.status}`, { status: 409 });
      const d = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : null;
      if (!d) return new Response("Choose approve or reject", { status: 400 });
      const err = await decide(db, a, d, String(b.comment || "").slice(0, 2000), ap);
      if (err) return new Response(err, { status: 409 });
      return Response.json({ ok: true, status: d });
    }
    const s = sec(r.section);
    return Response.json({
      status: a.status, title: r.title, section: s?.label, record_status: r.status, details: details(r), note: a.note, comment: a.comment,
      requested_by: rq?.full_name || rq?.email, approver: ap?.full_name || ap?.email, created_at: a.created_at, decided_at: a.decided_at,
      controlled: r.controlled, url: `${SITE}/${r.section.replace(".", "/")}?r=${r.id}`, lang: ap?.lang || "en",
    });
  }

  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  const sb = await userClient();
  { const lim = await limit(`approvals:${me.id}`, 60, 60, db); if (lim) return lim; }

  if (b.action === "limits") return Response.json(withLimits((await getSettings(db)).limits));
  if (b.action === "approvers") {
    const { data: r } = await sb.from("records").select("id,section,controlled,data").eq("id", b.record_id).maybeSingle();
    if (!r || !APPROVALS[r.section]) return Response.json([]);
    return Response.json((await approversFor(db, r, me.id)).map((p: any) => ({ id: p.id, name: p.full_name || p.email, role: p.role })));
  }

  if (b.action === "request") {
    const { data: r } = await sb.from("records").select("*").eq("id", b.record_id).maybeSingle(); // visible to the requester?
    if (!r) return new Response("Record not found", { status: 404 });
    const rule = APPROVALS[r.section];
    if (!rule) return new Response("This section has no approvals", { status: 400 });
    if (!rule.wait.includes(r.status)) return new Response(`Only records in status ${rule.wait.join(" / ")} can be sent for approval`, { status: 400 });
    if (approvalNeeds(r.section, r.data)) return new Response("Run the compliance check first (Passed or Cleared by legal), then send for approval", { status: 400 });
    const ap = (await approversFor(db, r, me.id)).find((p: any) => p.id === b.approver_id);
    if (!ap) return new Response("Choose an approver from the list", { status: 400 });
    await db.from("approvals").update({ status: "cancelled" }).eq("record_id", r.id).eq("status", "pending");
    const token = newToken();
    const note = String(b.note || "").slice(0, 2000);
    const { data: a, error } = await db.from("approvals").insert({ token: null, token_hash: hashToken(token), record_id: r.id, section: r.section, requested_by: me.id, approver_id: ap.id, note: note || null }).select("id,status,created_at,expires_at").single();
    if (error) return new Response(error.message, { status: 500 });
    const lang = ap.lang === "ru" ? "ru" : "en"; const s = sec(r.section);
    const lines = details(r).map((d: any) => `- **${lang === "ru" ? d.label_ru : d.label}:** ${d.value}`).join("\n");
    const subject = `${L(lang, "Approval needed", "Нужно согласование")}: ${r.title}`;
    const body = `${L(lang, `${me.full_name || me.email} asks you to approve:`, `${me.full_name || me.email} просит согласовать:`)}\n\n**${r.title}** · ${s?.label?.[lang] || s?.label?.en}\n\n${lines}${note ? `\n\n${L(lang, "Note", "Комментарий")}: ${note}` : ""}${r.controlled ? `\n\n${L(lang, "Contains export-controlled data — US persons only.", "Содержит данные под экспортным контролем — только для US persons.")}` : ""}`;
    const url = `${SITE}/approve/${token}`;
    const cta = { label: L(lang, "Approve or reject", "Согласовать или отклонить"), url };
    const full = body + `\n\n${L(lang, "One click opens the decision page; the link works for 14 days.", "Кнопка откроет страницу решения; ссылка действует 14 дней.")}`;
    const m = ["uk", "ar"].includes(ap.lang) ? await localizeMail(db, ap.lang, { subject, body: full, text: cta.label }) : { subject, body: full, text: cta.label };
    const ml = (["uk", "ar"].includes(ap.lang) ? ap.lang : lang) as any; const c2 = { ...cta, label: m.text };
    const err = await sendMail({ to: ap.email, subject: m.subject, html: renderEmail({ subject: m.subject, heading: m.subject, body: m.body!, cta: c2, lang: ml, sender: COMPANY }), text: plainText({ body: m.body!, cta: c2, sender: COMPANY, lang: ml }), replyTo: me.email });
    await pushTo(db, [ap.id], (l) => ({ title: PUSH.approve_t[l], body: `${r.controlled ? "US-persons-only record" : r.title} — ${me.full_name || me.email}`, url, tag: `ap-${a.id}` })).catch((e) => reportError(db, "approvals:push", e));
    await sb.from("comments").insert({ record_id: r.id, author: me.id, body: `→ Sent for approval to ${ap.full_name || ap.email}${note ? `: ${note}` : ""}` });
    return Response.json({ ...a, approver: ap.full_name || ap.email, mail_error: err });
  }

  if (b.action === "cancel") {
    const { data: a } = await db.from("approvals").select("id,requested_by,status").eq("id", b.id).maybeSingle();
    if (!a || (a.requested_by !== me.id && !["owner", "admin"].includes(me.role))) return new Response("Not allowed", { status: 403 });
    await db.from("approvals").update({ status: "cancelled" }).eq("id", a.id).eq("status", "pending");
    return Response.json({ ok: true });
  }

  if (b.action === "decide" && b.id) {
    const { data: a } = await db.from("approvals").select("*").eq("id", b.id).maybeSingle();
    if (!a || a.approver_id !== me.id) return new Response("Not allowed", { status: 403 });
    if (a.status !== "pending") return new Response(`Already ${a.status}`, { status: 409 });
    const d = b.decision === "approved" ? "approved" : "rejected";
    const err = await decide(db, a, d, String(b.comment || "").slice(0, 2000), me);
    if (err) return new Response(err, { status: 409 });
    return Response.json({ ok: true, status: d });
  }
  return new Response("Unknown action", { status: 400 });
}
