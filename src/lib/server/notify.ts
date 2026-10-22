// Delivery of personal notifications by e-mail and to the phone. The database writes each notification once
// (unique per person and event); this job takes the waiting ones in batches (FOR UPDATE SKIP LOCKED), sends one
// e-mail per person per run with everything new, and records the outcome on each row. An e-mail whose delivery is
// uncertain is never sent again by itself. Approval requests and decisions already go out by the approvals route
// (with the one-click link), so they are not e-mailed twice here.
import { sendMailDetailed } from "./mailer";
import { pushTo } from "./push";
import { renderEmail, SITE } from "@/lib/mail";
import { reportError } from "./errors";
import { emailDecision, localTime, pushDecision } from "@/lib/notifyprefs";

const OWN_CHANNEL = new Set(["approval_requested", "approval_done"]);
const T: Record<string, Record<string, string>> = {
  subject: { en: "AGRON Workspace: {n} new for you", ru: "AGRON Workspace: новое для вас — {n}", uk: "AGRON Workspace: нове для вас — {n}", ar: "AGRON Workspace: {n} جديد لك" },
  digest: { en: "AGRON Workspace: your daily summary ({n})", ru: "AGRON Workspace: сводка за день ({n})", uk: "AGRON Workspace: підсумок за день ({n})", ar: "AGRON Workspace: ملخصك اليومي ({n})" },
  open: { en: "Open in Workspace", ru: "Открыть в Workspace", uk: "Відкрити у Workspace", ar: "افتح في مساحة العمل" },
  settings: { en: "Choose what reaches you by e-mail in My profile → Notifications.", ru: "Что приходит на почту, можно выбрать в «Мой профиль» → «Уведомления».", uk: "Що надходить поштою, можна вибрати в «Мій профіль» → «Сповіщення».", ar: "اختر ما يصلك بالبريد من ملفي ← الإشعارات." },
};
const K: Record<string, Record<string, string>> = {
  mgmt_alert: { en: "Management alert", ru: "Оповещение руководства", uk: "Сповіщення керівництва", ar: "تنبيه إداري" }, waiting_remind: { en: "Someone is waiting for this", ru: "Этого ждут от вас", uk: "Цього чекають від вас", ar: "شخص ينتظر هذا" },
  waiting_escalated: { en: "Escalated", ru: "Эскалировано", uk: "Ескальовано", ar: "تم التصعيد" },
  wf_action: { en: "A process step needs you", ru: "Шаг процесса ждёт вас", uk: "Крок процесу чекає на вас", ar: "خطوة في عملية تحتاجك" }, wf_due_soon: { en: "Process step due soon", ru: "Скоро срок шага процесса", uk: "Скоро термін кроку процесу", ar: "خطوة قريبة الاستحقاق" },
  wf_overdue: { en: "Process step overdue", ru: "Шаг процесса просрочен", uk: "Крок процесу прострочено", ar: "خطوة متأخرة" }, wf_escalated: { en: "Process step escalated to you", ru: "Шаг процесса эскалирован вам", uk: "Крок процесу ескальовано вам", ar: "صُعّدت إليك خطوة" },
  crm_opp_assigned: { en: "An opportunity was assigned to you", ru: "Вам назначена возможность", uk: "Вам призначено можливість", ar: "أُسندت إليك فرصة" },
  crm_lead_assigned: { en: "A lead was assigned to you", ru: "Вам назначен лид", uk: "Вам призначено лід", ar: "أُسند إليك عميل محتمل" },
  crm_follow_up_due: { en: "Commercial follow-up due", ru: "Пора связаться с клиентом", uk: "Час зв'язатися з клієнтом", ar: "حان موعد المتابعة التجارية" },
  crm_follow_up_overdue: { en: "Commercial follow-up overdue", ru: "Просрочен контакт с клиентом", uk: "Прострочено контакт із клієнтом", ar: "متابعة تجارية متأخرة" },
  crm_lead_follow_up: { en: "Lead follow-up due", ru: "Пора связаться с лидом", uk: "Час зв'язатися з лідом", ar: "حان موعد متابعة العميل المحتمل" },
  crm_event_follow_up: { en: "Event leads to follow up", ru: "Лиды с выставки ждут контакта", uk: "Ліди з виставки чекають контакту", ar: "عملاء المعرض بانتظار المتابعة" },
  crm_meeting_soon: { en: "Commercial meeting soon", ru: "Скоро коммерческая встреча", uk: "Скоро комерційна зустріч", ar: "اجتماع تجاري قريب" },
  crm_proposal_expiring: { en: "Proposal validity ends soon", ru: "Скоро истекает срок КП", uk: "Скоро спливає термін КП", ar: "صلاحية العرض تنتهي قريبًا" },
  crm_decision_due: { en: "Customer decision expected", ru: "Ожидается решение клиента", uk: "Очікується рішення клієнта", ar: "قرار العميل متوقع" },
  crm_stalled: { en: "Opportunity stalled", ru: "Возможность застряла", uk: "Можливість застрягла", ar: "فرصة متوقفة" },
  crm_hold_review: { en: "On-hold opportunity due for review", ru: "Пора пересмотреть приостановленную возможность", uk: "Час переглянути призупинену можливість", ar: "حان مراجعة الفرصة المعلقة" },
  wf_done: { en: "Your request is finished", ru: "Ваша заявка завершена", uk: "Вашу заявку завершено", ar: "اكتمل طلبك" },
  assigned: { en: "Assigned to you", ru: "Назначено вам", uk: "Призначено вам", ar: "أُسند إليك" }, reassigned: { en: "Reassigned to you", ru: "Переназначено вам", uk: "Перепризначено вам", ar: "أُعيد إسناده إليك" },
  unassigned: { en: "No longer assigned to you", ru: "Снято с вас", uk: "Знято з вас", ar: "لم يعد مسنداً إليك" }, status: { en: "Status changed", ru: "Статус изменён", uk: "Статус змінено", ar: "تغيّرت الحالة" },
  mention: { en: "Mentioned you", ru: "Вас упомянули", uk: "Вас згадали", ar: "ذُكرت" }, comment: { en: "New comment", ru: "Новый комментарий", uk: "Новий коментар", ar: "تعليق جديد" },
  due_soon: { en: "Deadline soon", ru: "Скоро срок", uk: "Скоро термін", ar: "موعد قريب" }, overdue: { en: "Overdue", ru: "Просрочено", uk: "Прострочено", ar: "متأخر" },
  milestone: { en: "Milestone changed", ru: "Изменилась веха", uk: "Змінилася віха", ar: "تغيّرت مرحلة" }, project_member: { en: "Project team", ru: "Команда проекта", uk: "Команда проєкту", ar: "فريق المشروع" },
  announcement: { en: "Announcement", ru: "Объявление", uk: "Оголошення", ar: "إعلان" }, announcement_critical: { en: "Critical announcement", ru: "Критическое объявление", uk: "Критичне оголошення", ar: "إعلان حرج" },
  reply: { en: "Replied to you", ru: "Вам ответили", uk: "Вам відповіли", ar: "رد عليك" }, project_message: { en: "Project message", ru: "Сообщение в проекте", uk: "Повідомлення в проєкті", ar: "رسالة في المشروع" },
  decision: { en: "Decision recorded", ru: "Записано решение", uk: "Записано рішення", ar: "سُجّل قرار" }, doc_version: { en: "New document version", ru: "Новая версия документа", uk: "Нова версія документа", ar: "نسخة جديدة من مستند" },
};
const tr = (m: Record<string, string> | undefined, l: string, fb = "") => (m ? m[l] || m.en : fb);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const plain = (s: unknown) => String(s ?? "").replace(/@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)/g, "@$1");
export const linkOf = (n: { link?: string | null; record_id?: string | null; section?: string | null }) => n.link || (n.record_id && n.section ? (n.section === "company.projects" ? `/projects/${n.record_id}` : `/${n.section.replace(".", "/")}?r=${n.record_id}`) : "/notifications");

/** One delivery pass. Returns counts; never throws for a single bad row.
 *  Per person: quiet hours and the e-mail mode (immediately / daily summary / off) from their own settings; critical
 *  events go out regardless. Controlled records never put their title or text into an e-mail or a phone banner. */
export async function deliverNotifications(db: any, o: { deadline?: number; batch?: number; now?: Date } = {}) {
  const out = { claimed: 0, emails: 0, email_items: 0, digests: 0, held: 0, pushed: 0, skipped: 0, failed: 0, uncertain: 0 };
  const until = o.deadline || Date.now() + 40_000;
  const seen = new Set<number>();
  while (Date.now() < until - 3000) {
    const now = o.now || new Date();
    const { data: claimed, error } = await db.rpc("notifications_claim", { p_limit: o.batch || 50 });
    if (error) throw new Error(error.message);
    const rows = (claimed || []).filter((r: any) => !seen.has(r.id)); // a row held back in this run is not looked at twice
    if (!rows.length) break;
    rows.forEach((r: any) => seen.add(r.id));
    out.claimed += rows.length;
    const ids = [...new Set(rows.map((r: any) => r.user_id))];
    const { data: ppl } = await db.from("profiles").select("id,email,full_name,lang,disabled,notify_prefs").in("id", ids);
    const pmap = new Map((ppl || []).map((p: any) => [p.id, p]));
    const recIds = [...new Set(rows.map((r: any) => r.record_id).filter(Boolean))];
    const { data: recs } = recIds.length ? await db.from("records").select("id,controlled").in("id", recIds) : { data: [] };
    const controlled = new Set((recs || []).filter((r: any) => r.controlled).map((r: any) => r.id));
    const safe = (n: any) => (controlled.has(n.record_id) ? { ...n, title: "Controlled record", body: "" } : n);
    const done = async (id: number, patch: Record<string, any>) => { const { error: e } = await db.from("notifications").update(patch).eq("id", id); if (e) await reportError(db, "notify:update", e); };
    const hold: number[] = [];
    // e-mail: one letter per person with everything due now
    const byUser = new Map<string, any[]>(); const digestUsers = new Set<string>();
    const today = new Map<string, boolean>();
    for (const r of rows) {
      if (r.email_state !== "sending") continue;
      const p: any = pmap.get(r.user_id);
      if (!p || p.disabled || !p.email || OWN_CHANNEL.has(r.kind)) { await done(r.id, { email_state: "skipped" }); out.skipped++; continue; }
      const prefs = p.notify_prefs || {};
      if (!today.has(r.user_id)) {
        const day = localTime(prefs.tz, now).day;
        const { data: d } = await db.from("notification_digests").select("day").eq("user_id", r.user_id).eq("day", day).maybeSingle();
        today.set(r.user_id, !!d);
      }
      const what = emailDecision(prefs, r.kind, now, today.get(r.user_id)!);
      if (what === "skip") { await done(r.id, { email_state: "skipped" }); out.skipped++; continue; }
      if (what === "hold") { hold.push(r.id); out.held++; continue; }
      if (what === "digest") digestUsers.add(r.user_id);
      byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);
    }
    for (const [uid, list0] of byUser) {
      const list = list0.map(safe);
      const p: any = pmap.get(uid); const l = ["en", "ru", "uk", "ar"].includes(p.lang) ? p.lang : "en";
      const digest = digestUsers.has(uid);
      const subject = tr(digest ? T.digest : T.subject, l).replace("{n}", String(list.length));
      const html = list.map((n) => `<p style="margin:0 0 12px"><b>${esc(tr(K[n.kind], l, n.kind))}</b> — <a href="${SITE}${linkOf(n)}">${esc(n.title || "")}</a>${n.body ? `<br><span style="color:#5A6673">${esc(plain(n.body)).slice(0, 300)}</span>` : ""}</p>`).join("") + `<p style="color:#7A8796;font-size:12px">${esc(tr(T.settings, l))}</p>`;
      const text = list.map((n) => `${tr(K[n.kind], l, n.kind)} — ${n.title || ""}\n${SITE}${linkOf(n)}${n.body ? `\n${plain(n.body).slice(0, 300)}` : ""}`).join("\n\n") + `\n\n${tr(T.settings, l)}`;
      const r = await sendMailDetailed({ to: p.email, subject, html: renderEmail({ subject, heading: subject, body: "", html, cta: { label: tr(T.open, l), url: `${SITE}/notifications` }, lang: l, sender: null }), text });
      const at = new Date().toISOString();
      for (const n of list) {
        if (r.ok) await done(n.id, { email_state: "sent", delivered_at: at, error: null });
        else if (r.verdict?.kind === "uncertain") await done(n.id, { email_state: "uncertain", error: `uncertain: ${r.error}`.slice(0, 500) }); // never sent again by itself
        else await done(n.id, { email_state: r.verdict?.kind === "permanent" || n.attempts >= 5 ? "failed" : "pending", error: String(r.error || "").slice(0, 500) });
      }
      if (r.ok && digest) { await db.from("notification_digests").upsert({ user_id: uid, day: localTime((p.notify_prefs || {}).tz, now).day, items: list.length }); out.digests++; }
      if (r.ok) { out.emails++; out.email_items += list.length; } else if (r.verdict?.kind === "uncertain") out.uncertain++; else out.failed++;
    }
    // phone
    for (const r0 of rows) {
      if (r0.push_state !== "pending") continue;
      const r = safe(r0); const p: any = pmap.get(r.user_id);
      if (OWN_CHANNEL.has(r.kind)) { await done(r.id, { push_state: "skipped" }); continue; }
      if (pushDecision(p?.notify_prefs, r.kind, now) === "hold") { if (!hold.includes(r.id)) { hold.push(r.id); out.held++; } continue; }
      try {
        const n = await pushTo(db, [r.user_id], () => ({ title: r.title || "AGRON Workspace", body: plain(r.body || "").slice(0, 180), url: linkOf(r), tag: `n-${r.id}` }));
        await done(r.id, { push_state: n ? "sent" : "skipped" }); if (n) out.pushed++;
      } catch (e: any) { await done(r.id, { push_state: r.attempts >= 5 ? "failed" : "pending", error: String(e?.message || e).slice(0, 500) }); out.failed++; }
    }
    if (hold.length) { const { error: e } = await db.rpc("notifications_release", { p_ids: hold, p_state: "held" }); if (e) await reportError(db, "notify:hold", e); }
    if (rows.length < (o.batch || 50)) break;
  }
  return out;
}

/** Announcements whose publication date has come: the audience is told once per version. */
export async function announceDue(db: any) {
  const { data, error } = await db.rpc("announcements_dispatch_due", {});
  if (error) throw new Error(error.message);
  return { notified: data ?? 0 };
}

/** Deadlines: due tomorrow or today, and overdue — once per person and date. */
export async function dueNotices(db: any) {
  const { data, error } = await db.rpc("notify_due", {});
  if (error) throw new Error(error.message);
  return { created: data ?? 0 };
}
