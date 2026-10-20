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
 *  decide    {token | id, decision, comment} → approve, request changes (comment required) or reject; updates the record and emails the requester
 */
const SECS: any[] = allSections() as any[];
const sec = (id: string) => SECS.find((s) => s.id === id);
const fmt = (f: any, v: any) => (v == null || v === "" ? "" : f?.type === "money" || f?.type === "number" ? Number(v).toLocaleString("en-US") : String(v).length > 1500 ? String(v).slice(0, 1500) + "…" : String(v));
const L = (lang: string, en: string, ru: string) => (lang === "ru" || lang === "uk" ? ru : en);


function details(r: any) {
  const s = sec(r.section); const rule = APPROVALS[r.section];
  return (rule?.key || []).map((k) => { const f = s?.fields.find((x: any) => x.key === k); const v = f?.type === "ref" ? String(r.data?.[`${k}_title`] || "") : fmt(f, r.data?.[k]); return v ? { label: f?.label?.en || k, label_ru: f?.label?.ru || f?.label?.en || k, value: v } : null; }).filter(Boolean) as any[];
}

/** The approval plan of a document type: single approver, or a sequential / parallel chain of steps with roles. */
async function docPlan(db: any, r: any) {
  const { data: t } = await db.from("taxonomy").select("meta").eq("kind", "doc_type").eq("code", r.data?.doc_type || "").maybeSingle();
  const ap = t?.meta?.approval || {};
  const mode: "single" | "sequential" | "all" = ap.mode === "sequential" || ap.mode === "all" ? ap.mode : "single";
  const steps: { label?: string; roles?: string[] }[] = Array.isArray(ap.steps) && ap.steps.length ? ap.steps : [{}];
  return { mode, steps: mode === "single" ? [steps[0]] : steps };
}
async function stepRoles(db: any, r: any, a: any): Promise<string[] | null> {
  if (r.section !== "company.documents" || !a.chain_id) return null;
  const plan = await docPlan(db, r); const roles = plan.steps[(a.step || 1) - 1]?.roles;
  return Array.isArray(roles) && roles.length ? roles : null;
}
async function approversFor(db: any, r: any, exclude: string, roles?: string[] | null) {
  const rule = APPROVALS[r.section]; if (!rule) return [];
  if (roles?.length) { const { data } = await db.from("profiles").select("id,full_name,email,role,us_person,lang,disabled").in("role", roles).neq("id", exclude); return (data || []).filter((p: any) => !p.disabled && (!r.controlled || p.us_person)); }
  // Spending: only the roles whose limit covers this amount (Administration → System → Settings → Approval limits)
  const lim = limitRoles(r.section, r.data || {}, withLimits((await getSettings(db)).limits));
  const { data } = await db.from("profiles").select("id,full_name,email,role,us_person,lang").in("role", lim || rule.approvers).neq("id", exclude);
  return (data || []).filter((p: any) => !r.controlled || p.us_person);
}

type Decision = "approved" | "rejected" | "changes_requested";
async function decide(db: any, a: any, decision: Decision, comment: string, by: any) {
  const { data: r } = await db.from("records").select("*").eq("id", a.record_id).single();
  if (!r) return "Record not found";
  const rule = APPROVALS[r.section];
  // checked again now, not only when the link was sent: the approver must still be allowed to decide
  const { data: ap } = await db.from("profiles").select("id,role,us_person,disabled").eq("id", a.approver_id).maybeSingle();
  const lim = rule ? limitRoles(r.section, r.data || {}, withLimits((await getSettings(db)).limits)) : null;
  const sr = rule ? await stepRoles(db, r, a) : null;
  if (!ap || ap.disabled || !rule || !(sr || lim || rule.approvers).includes(ap.role) || (r.controlled && !ap.us_person)) return "The approver is no longer allowed to decide this request";
  const now = new Date().toISOString();
  const { data: upd } = await db.from("approvals").update({ status: decision, comment: comment || null, decided_at: now, decided_by: by.id }).eq("id", a.id).eq("status", "pending").select("id");
  if (!upd?.length) return "This request was already decided";
  const who = by.full_name || by.email;
  // a chain: the next step, or the end of the chain
  if (a.chain_id) {
    const { data: chain } = await db.from("approvals").select("*").eq("chain_id", a.chain_id).order("step");
    if (decision === "approved") {
      const rest = (chain || []).filter((x: any) => x.id !== a.id && x.status !== "approved" && x.status !== "cancelled");
      if (rest.length) {
        if (a.chain_mode === "sequential") { const next = rest.filter((x: any) => x.status === "queued").sort((x: any, y: any) => x.step - y.step)[0]; if (next) await activateStep(db, r, next); }
        await db.from("comments").insert({ record_id: r.id, author: by.id, kind: "approval", body: `✓ Step ${a.step} approved by ${who}${comment ? `: ${comment}` : ""}` });
        return null;
      }
    } else {
      await db.from("approvals").update({ status: "cancelled", comment: `Stopped: step ${a.step} ${decision === "rejected" ? "rejected" : "asked for changes"}` }).eq("chain_id", a.chain_id).in("status", ["pending", "queued"]);
    }
  }
  // the decision belongs to the exact version it was asked for; the record follows only if that version is still current
  const current = !a.version_id || r.data?.current_version_id === a.version_id;
  if (a.version_id) await db.rpc("document_version_decided", { p_version: a.version_id, p_state: decision, p_by: by.id });
  const status = decision === "approved" ? rule?.ok : decision === "changes_requested" ? rule?.changes || rule?.no || rule?.wait[0] : rule?.no;
  if (status && current) await db.from("records").update({ status }).eq("id", r.id);
  if (decision === "approved" && r.section === "company.documents") {
    const { data: v } = a.version_id ? await db.from("document_versions").select("label").eq("id", a.version_id).maybeSingle() : { data: null };
    const key = `approval:${a.chain_id || a.id}`;
    const { data: ex } = await db.from("records").select("id").eq("section", "company.decisions").eq("data->>_idem", key).maybeSingle();
    if (!ex) await db.from("records").insert({ section: "company.decisions", title: `Approved: ${r.title}${v?.label ? ` v${v.label}` : ""}`.slice(0, 200), status: "Approved", controlled: r.controlled, created_by: by.id,
      data: { _idem: key, date: now.slice(0, 10), decision: `${r.data?.doc_number || r.title}${v?.label ? ` version ${v.label}` : ""} approved by ${who}${comment ? ` — ${comment}` : ""}`, made_by_id: by.id, source_ref: r.id, source_ref_title: r.title, source_section: "approval",
        document_ref: r.id, document_ref_title: r.title, project_ref: r.data?.project_ref, project_ref_title: r.data?.project_ref_title, version_id: a.version_id, version: v?.label } });
  }
  await db.from("comments").insert({ record_id: r.id, author: by.id, kind: "approval", body: `${decision === "approved" ? "✓ Approved" : decision === "changes_requested" ? "↺ Changes requested" : "✗ Rejected"} by ${who}${comment ? `: ${comment}` : ""}` });
  const { data: req } = await db.from("profiles").select("email,full_name,lang").eq("id", a.requested_by).single();
  if (req?.email) {
    const lang = req.lang === "ru" ? "ru" : "en"; const s = sec(r.section);
    const ok = decision === "approved", ch = decision === "changes_requested";
    const subject = `${ok ? L(lang, "Approved", "Согласовано") : ch ? L(lang, "Changes requested", "Нужны изменения") : L(lang, "Rejected", "Отклонено")}: ${r.title}`;
    const body = `${L(lang, `${who} ${ok ? "approved" : ch ? "asked for changes to" : "rejected"} your request.`, `${who} ${ok ? "согласовал(а)" : ch ? "просит изменить" : "отклонил(а)"} ваш запрос.`)}\n\n**${r.title}** · ${s?.label?.[lang] || s?.label?.en}${comment ? `\n\n${L(lang, "Comment", "Комментарий")}: ${comment}` : ""}`;
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
      const d: Decision | null = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : b.decision === "changes_requested" ? "changes_requested" : null;
      if (!d) return new Response("Choose approve, request changes or reject", { status: 400 });
      if (d === "changes_requested" && !String(b.comment || "").trim()) return new Response("Say what needs to change", { status: 400 });
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
    if (r.section === "company.documents") {
      const plan = await docPlan(db, r);
      const steps = await Promise.all(plan.steps.map(async (st, i) => ({ step: i + 1, label: st.label || null, people: (await approversFor(db, r, me.id, st.roles)).map((p: any) => ({ id: p.id, name: p.full_name || p.email, role: p.role })) })));
      return Response.json(Object.assign(steps[0].people, { mode: plan.mode, steps }));
    }
    return Response.json((await approversFor(db, r, me.id)).map((p: any) => ({ id: p.id, name: p.full_name || p.email, role: p.role })));
  }

  if (b.action === "request") {
    const { data: r } = await sb.from("records").select("*").eq("id", b.record_id).maybeSingle(); // visible to the requester?
    if (!r) return new Response("Record not found", { status: 404 });
    const rule = APPROVALS[r.section];
    if (!rule) return new Response("This section has no approvals", { status: 400 });
    if (!rule.wait.includes(r.status)) return new Response(`Only records in status ${rule.wait.join(" / ")} can be sent for approval`, { status: 400 });
    if (approvalNeeds(r.section, r.data)) return new Response("Run the compliance check first (Passed or Cleared by legal), then send for approval", { status: 400 });
    const note = String(b.note || "").slice(0, 2000);
    if (r.section === "company.documents") return requestDocument(db, r, me, b, note);
    const ap = (await approversFor(db, r, me.id)).find((p: any) => p.id === b.approver_id);
    if (!ap) return new Response("Choose an approver from the list", { status: 400 });
    await db.from("approvals").update({ status: "cancelled" }).eq("record_id", r.id).eq("status", "pending");
    const token = newToken();
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
    await db.from("comments").insert({ record_id: r.id, author: me.id, kind: "approval", body: `→ Sent for approval to ${ap.full_name || ap.email}${note ? `: ${note}` : ""}` });
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
    const d: Decision = b.decision === "approved" ? "approved" : b.decision === "changes_requested" ? "changes_requested" : "rejected";
    if (d === "changes_requested" && !String(b.comment || "").trim()) return new Response("Say what needs to change", { status: 400 });
    const err = await decide(db, a, d, String(b.comment || "").slice(0, 2000), me);
    if (err) return new Response(err, { status: 409 });
    return Response.json({ ok: true, status: d });
  }
  return new Response("Unknown action", { status: 400 });
}

/** The approver of a step is told (e-mail with the one-click link, phone); the request is noted on the record. */
async function mailApprover(db: any, r: any, a: any, ap: any, token: string, by: any, note: string, extra = "") {
  const lang = ap.lang === "ru" ? "ru" : "en"; const s = sec(r.section);
  const lines = details(r).map((d: any) => `- **${lang === "ru" ? d.label_ru : d.label}:** ${d.value}`).join("\n");
  const subject = `${L(lang, "Approval needed", "Нужно согласование")}: ${r.controlled ? L(lang, "US-persons-only document", "Документ только для US persons") : r.title}`;
  const body = `${L(lang, `${by.full_name || by.email} asks you to approve:`, `${by.full_name || by.email} просит согласовать:`)}\n\n**${r.controlled ? r.data?.doc_number || "—" : r.title}** · ${s?.label?.[lang] || s?.label?.en}${extra}\n\n${r.controlled ? "" : lines}${note ? `\n\n${L(lang, "Note", "Комментарий")}: ${note}` : ""}`;
  const url = `${SITE}/approve/${token}`; const cta = { label: L(lang, "Approve or reject", "Согласовать или отклонить"), url };
  const m = ["uk", "ar"].includes(ap.lang) ? await localizeMail(db, ap.lang, { subject, body, text: cta.label }) : { subject, body, text: cta.label };
  const ml = (["uk", "ar"].includes(ap.lang) ? ap.lang : lang) as any; const c2 = { ...cta, label: m.text };
  const err = await sendMail({ to: ap.email, subject: m.subject, html: renderEmail({ subject: m.subject, heading: m.subject, body: m.body!, cta: c2, lang: ml, sender: COMPANY }), text: plainText({ body: m.body!, cta: c2, sender: COMPANY, lang: ml }), replyTo: by.email });
  await pushTo(db, [ap.id], (l) => ({ title: PUSH.approve_t[l], body: `${r.controlled ? "US-persons-only record" : r.title} — ${by.full_name || by.email}`, url, tag: `ap-${a.id}` })).catch((e) => reportError(db, "approvals:push", e));
  return err;
}

/** A queued step of a sequential chain becomes the next approver's request. */
async function activateStep(db: any, r: any, next: any) {
  const token = newToken();
  const { data: upd } = await db.from("approvals").update({ status: "pending", token_hash: hashToken(token), expires_at: new Date(Date.now() + 14 * 864e5).toISOString() }).eq("id", next.id).eq("status", "queued").select("*");
  if (!upd?.length) return;
  const [{ data: ap }, { data: by }] = await Promise.all([db.from("profiles").select("id,full_name,email,lang").eq("id", next.approver_id).single(), db.from("profiles").select("id,full_name,email").eq("id", next.requested_by).single()]);
  if (ap?.email) await mailApprover(db, r, next, ap, token, by || { email: "" }, next.note || "", ` · ${L(ap.lang, "step", "этап")} ${next.step}`);
}

/** A document is approved as one exact version: one approver, or a chain (sequential or all at once) set by its type. */
async function requestDocument(db: any, r: any, me: any, b: any, note: string) {
  const versionId = r.data?.current_version_id;
  if (!versionId) return new Response("Upload a version first: approval is given to an exact version", { status: 400 });
  const plan = await docPlan(db, r);
  const ids: string[] = (Array.isArray(b.approver_ids) ? b.approver_ids : [b.approver_id]).map(String).filter(Boolean).slice(0, plan.steps.length);
  if (ids.length !== plan.steps.length) return new Response(plan.steps.length > 1 ? `Choose an approver for each of the ${plan.steps.length} steps` : "Choose an approver from the list", { status: 400 });
  if (new Set(ids).size !== ids.length) return new Response("Each step needs a different approver", { status: 400 });
  const people: any[] = [];
  for (let i = 0; i < ids.length; i++) {
    const ap = (await approversFor(db, r, me.id, plan.steps[i].roles)).find((p: any) => p.id === ids[i]);
    if (!ap) return new Response(`The approver for step ${i + 1} is not allowed to approve this document`, { status: 400 });
    people.push(ap);
  }
  await db.from("approvals").update({ status: "cancelled" }).eq("record_id", r.id).in("status", ["pending", "queued"]);
  const chain = plan.mode === "single" ? null : crypto.randomUUID();
  const rows = people.map((ap, i) => ({ ap, token: newToken(), status: plan.mode === "sequential" && i > 0 ? "queued" : "pending", step: i + 1 }));
  const { data: made, error } = await db.from("approvals").insert(rows.map((x) => ({ token: null, token_hash: hashToken(x.token), record_id: r.id, section: r.section, requested_by: me.id, approver_id: x.ap.id,
    note: note || null, status: x.status, step: x.step, chain_id: chain, chain_mode: plan.mode, version_id: versionId }))).select("id,status,step,created_at,expires_at,approver_id");
  if (error) return new Response(error.message, { status: 500 });
  await db.rpc("document_version_decided", { p_version: versionId, p_state: "pending", p_by: me.id });
  if (["Draft", "Changes requested"].includes(r.status)) await db.from("records").update({ status: "In review" }).eq("id", r.id);
  let mail_error: string | null = null;
  for (const x of rows) if (x.status === "pending") { const a = (made || []).find((m: any) => m.approver_id === x.ap.id); const e = await mailApprover(db, r, a, x.ap, x.token, me, note, plan.mode === "single" ? "" : ` · step ${x.step}/${rows.length}`); mail_error = mail_error || (e as any); }
  const { data: v } = await db.from("document_versions").select("label").eq("id", versionId).maybeSingle();
  await db.from("comments").insert({ record_id: r.id, author: me.id, kind: "approval", body: `→ Version ${v?.label || "?"} sent for approval to ${people.map((p) => p.full_name || p.email).join(plan.mode === "sequential" ? " → " : ", ")}${note ? `: ${note}` : ""}` });
  return Response.json({ ...(made || [])[0], chain_id: chain, mode: plan.mode, steps: made, version: v?.label, approver: people[0].full_name || people[0].email, mail_error });
}
