// Delivery of personal notifications by e-mail and to the phone. The database writes each notification once
// (unique per person and event); this job takes the waiting ones in batches (FOR UPDATE SKIP LOCKED), sends one
// e-mail per person per run with everything new, and records the outcome on each row. An e-mail whose delivery is
// uncertain is never sent again by itself. Approval requests and decisions already go out by the approvals route
// (with the one-click link), so they are not e-mailed twice here.
import { sendMailDetailed } from "./mailer";
import { pushTo } from "./push";
import { renderEmail, SITE } from "@/lib/mail";
import { reportError } from "./errors";

const OWN_CHANNEL = new Set(["approval_requested", "approval_done"]);
const T: Record<string, Record<string, string>> = {
  subject: { en: "AGRON Workspace: {n} new for you", ru: "AGRON Workspace: новое для вас — {n}", uk: "AGRON Workspace: нове для вас — {n}", ar: "AGRON Workspace: {n} جديد لك" },
  open: { en: "Open in Workspace", ru: "Открыть в Workspace", uk: "Відкрити у Workspace", ar: "افتح في مساحة العمل" },
  settings: { en: "Choose what reaches you by e-mail in My profile → Notifications.", ru: "Что приходит на почту, можно выбрать в «Мой профиль» → «Уведомления».", uk: "Що надходить поштою, можна вибрати в «Мій профіль» → «Сповіщення».", ar: "اختر ما يصلك بالبريد من ملفي ← الإشعارات." },
};
const K: Record<string, Record<string, string>> = {
  assigned: { en: "Assigned to you", ru: "Назначено вам", uk: "Призначено вам", ar: "أُسند إليك" }, reassigned: { en: "Reassigned to you", ru: "Переназначено вам", uk: "Перепризначено вам", ar: "أُعيد إسناده إليك" },
  unassigned: { en: "No longer assigned to you", ru: "Снято с вас", uk: "Знято з вас", ar: "لم يعد مسنداً إليك" }, status: { en: "Status changed", ru: "Статус изменён", uk: "Статус змінено", ar: "تغيّرت الحالة" },
  mention: { en: "Mentioned you", ru: "Вас упомянули", uk: "Вас згадали", ar: "ذُكرت" }, comment: { en: "New comment", ru: "Новый комментарий", uk: "Новий коментар", ar: "تعليق جديد" },
  due_soon: { en: "Deadline soon", ru: "Скоро срок", uk: "Скоро термін", ar: "موعد قريب" }, overdue: { en: "Overdue", ru: "Просрочено", uk: "Прострочено", ar: "متأخر" },
  milestone: { en: "Milestone changed", ru: "Изменилась веха", uk: "Змінилася віха", ar: "تغيّرت مرحلة" }, project_member: { en: "Project team", ru: "Команда проекта", uk: "Команда проєкту", ar: "فريق المشروع" },
  announcement: { en: "Announcement", ru: "Объявление", uk: "Оголошення", ar: "إعلان" },
};
const tr = (m: Record<string, string> | undefined, l: string, fb = "") => (m ? m[l] || m.en : fb);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const plain = (s: unknown) => String(s ?? "").replace(/@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)/g, "@$1");
export const linkOf = (n: { link?: string | null; record_id?: string | null; section?: string | null }) => n.link || (n.record_id && n.section ? (n.section === "company.projects" ? `/projects/${n.record_id}` : `/${n.section.replace(".", "/")}?r=${n.record_id}`) : "/notifications");

/** One delivery pass. Returns counts; never throws for a single bad row. */
export async function deliverNotifications(db: any, o: { deadline?: number; batch?: number } = {}) {
  const out = { claimed: 0, emails: 0, email_items: 0, pushed: 0, skipped: 0, failed: 0, uncertain: 0 };
  const until = o.deadline || Date.now() + 40_000;
  while (Date.now() < until - 3000) {
    const { data: rows, error } = await db.rpc("notifications_claim", { p_limit: o.batch || 50 });
    if (error) throw new Error(error.message);
    if (!rows?.length) break;
    out.claimed += rows.length;
    const ids = [...new Set(rows.map((r: any) => r.user_id))];
    const { data: ppl } = await db.from("profiles").select("id,email,full_name,lang,disabled").in("id", ids);
    const pmap = new Map((ppl || []).map((p: any) => [p.id, p]));
    const done = async (id: number, patch: Record<string, any>) => { const { error: e } = await db.from("notifications").update(patch).eq("id", id); if (e) await reportError(db, "notify:update", e); };
    // e-mail: one letter per person with everything new for them
    const byUser = new Map<string, any[]>();
    for (const r of rows) {
      if (r.email_state !== "sending") continue;
      const p: any = pmap.get(r.user_id);
      if (!p || p.disabled || !p.email || OWN_CHANNEL.has(r.kind)) { await done(r.id, { email_state: "skipped" }); out.skipped++; continue; }
      byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);
    }
    for (const [uid, list] of byUser) {
      const p: any = pmap.get(uid); const l = ["en", "ru", "uk", "ar"].includes(p.lang) ? p.lang : "en";
      const subject = tr(T.subject, l).replace("{n}", String(list.length));
      const html = list.map((n) => `<p style="margin:0 0 12px"><b>${esc(tr(K[n.kind], l, n.kind))}</b> — <a href="${SITE}${linkOf(n)}">${esc(n.title || "")}</a>${n.body ? `<br><span style="color:#5A6673">${esc(plain(n.body)).slice(0, 300)}</span>` : ""}</p>`).join("") + `<p style="color:#7A8796;font-size:12px">${esc(tr(T.settings, l))}</p>`;
      const text = list.map((n) => `${tr(K[n.kind], l, n.kind)} — ${n.title || ""}\n${SITE}${linkOf(n)}${n.body ? `\n${plain(n.body).slice(0, 300)}` : ""}`).join("\n\n") + `\n\n${tr(T.settings, l)}`;
      const r = await sendMailDetailed({ to: p.email, subject, html: renderEmail({ subject, heading: subject, body: "", html, cta: { label: tr(T.open, l), url: `${SITE}/notifications` }, lang: l, sender: null }), text });
      const now = new Date().toISOString();
      for (const n of list) {
        if (r.ok) await done(n.id, { email_state: "sent", delivered_at: now, error: null });
        else if (r.verdict?.kind === "uncertain") await done(n.id, { email_state: "failed", error: `uncertain: ${r.error}`.slice(0, 500), attempts: 99 });
        else await done(n.id, { email_state: r.verdict?.kind === "permanent" || n.attempts >= 5 ? "failed" : "pending", error: String(r.error || "").slice(0, 500) });
      }
      if (r.ok) { out.emails++; out.email_items += list.length; } else if (r.verdict?.kind === "uncertain") out.uncertain++; else out.failed++;
    }
    // phone
    for (const r of rows) {
      if (r.push_state !== "pending") continue;
      if (OWN_CHANNEL.has(r.kind)) { await done(r.id, { push_state: "skipped" }); continue; }
      try {
        const n = await pushTo(db, [r.user_id], () => ({ title: r.title || "AGRON Workspace", body: plain(r.body || "").slice(0, 180), url: linkOf(r), tag: `n-${r.id}` }));
        await done(r.id, { push_state: n ? "sent" : "skipped" }); if (n) out.pushed++;
      } catch (e: any) { await done(r.id, { push_state: r.attempts >= 5 ? "failed" : "pending", error: String(e?.message || e).slice(0, 500) }); out.failed++; }
    }
    if (rows.length < (o.batch || 50)) break;
  }
  return out;
}

/** Deadlines: due tomorrow or today, and overdue — once per person and date. */
export async function dueNotices(db: any) {
  const { data, error } = await db.rpc("notify_due", {});
  if (error) throw new Error(error.message);
  return { created: data ?? 0 };
}
