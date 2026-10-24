import nodemailer from "nodemailer";
import { APP_ENV, blockedRecipients } from "@/lib/env";
import { adminClient } from "@/lib/server/supabase";
import { claimKeys, releaseKeys } from "@/lib/server/state";
import { reportError } from "@/lib/server/errors";
import { allSections, defaultRules } from "@/config/workspace.config.mjs";
import { dueItems, isMine } from "@/lib/insights";
import { COMPANY, SITE, plainText, renderEmail } from "@/lib/mail";
import { localHour, localDate } from "@/lib/tz";
import { localizeRec } from "@/lib/tr";
import { INTERNAL_ROLES, LEAD_ROLES } from "@/lib/roles";
const INTERNAL: string[] = [...INTERNAL_ROLES]; const LEADS: string[] = [...LEAD_ROLES];
const SECS: any[] = allSections() as any[];
type Lg = "en" | "ru" | "uk" | "ar";
const LG = (l: any): Lg => (["en", "ru", "uk", "ar"].includes(l) ? l : "en");
const label = (id: string, l: Lg) => { const x = SECS.find((s) => s.id === id)?.label; return x?.[l] || x?.en || id; };
// Russian and Ukrainian plural forms: 1 день, 2 дня, 5 дней
const pl = (n: number, one: string, few: string, many: string) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const when = (d: number, l: Lg) => {
  const n = Math.abs(d);
  if (l === "ru") return d < 0 ? `просрочено на ${n} ${pl(n, "день", "дня", "дней")}` : d === 0 ? "сегодня" : d === 1 ? "завтра" : `через ${n} ${pl(n, "день", "дня", "дней")}`;
  if (l === "uk") return d < 0 ? `прострочено на ${n} ${pl(n, "день", "дні", "днів")}` : d === 0 ? "сьогодні" : d === 1 ? "завтра" : `через ${n} ${pl(n, "день", "дні", "днів")}`;
  if (l === "ar") return d < 0 ? `متأخر ${n} يوم` : d === 0 ? "اليوم" : d === 1 ? "غداً" : `خلال ${n} أيام`;
  return d < 0 ? `${n} day${n === 1 ? "" : "s"} overdue` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${n} days`;
};
const TXT: Record<string, Record<Lg, string>> = {
  hello: { en: "Good morning{n}. Here is what needs attention today.", ru: "Доброе утро{n}. Вот что требует внимания сегодня.", uk: "Доброго ранку{n}. Ось що потребує уваги сьогодні.", ar: "صباح الخير{n}. هذا ما يحتاج انتباهك اليوم." },
  mine: { en: "Your deadlines and tasks", ru: "Ваши сроки и задачи", uk: "Ваші строки та задачі", ar: "مواعيدك ومهامك" },
  none: { en: "Nothing due in the next 7 days.", ru: "В ближайшие 7 дней сроков нет.", uk: "Найближчі 7 днів строків немає.", ar: "لا شيء مستحق خلال الأيام السبعة القادمة." },
  late: { en: "Overdue across the company", ru: "Просрочено по компании", uk: "Прострочено в компанії", ar: "المتأخرات في الشركة" },
  soon: { en: "Due in the next 3 days", ru: "Сроки в ближайшие 3 дня", uk: "Строки в найближчі 3 дні", ar: "مستحق خلال 3 أيام" },
  subj: { en: "AGRON Workspace · {k} for today", ru: "AGRON Workspace · на сегодня: {k}", uk: "AGRON Workspace · на сьогодні: {k}", ar: "AGRON Workspace · لليوم: {k}" },
  head: { en: "Your morning digest", ru: "Ваша утренняя сводка", uk: "Ваше ранкове зведення", ar: "ملخصك الصباحي" },
  open: { en: "Open AGRON Workspace", ru: "Открыть AGRON Workspace", uk: "Відкрити AGRON Workspace", ar: "افتح AGRON Workspace" },
};
const items = (n: number, l: Lg) => (l === "ru" ? `${n} ${pl(n, "пункт", "пункта", "пунктов")}` : l === "uk" ? `${n} ${pl(n, "пункт", "пункти", "пунктів")}` : l === "ar" ? `${n} بنود` : `${n} item${n === 1 ? "" : "s"}`);

/** Sends the morning digest. only = one person now (button); localOnly = only people for whom it is 8–11 in the morning. */
export async function runDigest(only: string | null, localOnly = false): Promise<{ ok: boolean; sent: number; skipped: number; error?: string }> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("Email sending is not configured (SMTP_PASS)");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Service key missing");
  const db = adminClient();
  const [{ data: profiles }, { data: rules }, { data: recs }] = await Promise.all([
    db.from("profiles").select("*"),
    db.from("section_access").select("section,role,can_write,external"),
    db.from("records").select("id,section,title,status,data,company,controlled,created_by,created_at,updated_at").neq("section", "legal.matrix").neq("section", "mail.outbox").limit(5000),
  ]);
  const rr = (rules?.length ? rules : defaultRules()) as any[];
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp.gmail.com", port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user: (process.env.SMTP_USER || "").trim(), pass: (process.env.SMTP_PASS || "").replace(/\s+/g, "") } /* Google app passwords are shown with spaces; Gmail needs the 16 letters only */ });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  let sent = 0; const skipped: string[] = [];
  // One digest per person per local day, sent around 8:00 in their own time zone: the day is claimed in the database before sending
  const now = new Date();

  for (const p of (profiles || []) as any[]) {
    if (only && p.id !== only) continue;
    if (!INTERNAL.includes(p.role) || !p.email) continue;
    let key = "";
    if (!only) {
      const tz = p.timezone || "America/New_York"; const day = localDate(now, tz); const h = localHour(now, tz);
      if (localOnly && (h < 8 || h > 11)) continue;            // not morning there yet
      key = `digest|${p.id}|${day}`;
      if (!(await claimKeys(db, [{ key, repeat: null }])).size) continue; // already sent today
    }
    // Same visibility the database enforces for this user
    const full = p.role === "owner" || p.role === "admin";
    const readable = new Set(full ? SECS.map((s) => s.id) : rr.filter((r) => r.role === p.role).map((r) => r.section));
    const l = LG(p.lang);
    // Titles in the reader's language when a translation exists
    const visible = (recs || []).filter((r: any) => readable.has(r.section) && (!r.controlled || p.us_person)).map((r: any) => localizeRec(r, l) || r);
    const due = dueItems(visible as any, 7);
    const mine = due.filter((x) => isMine(x.r, p)).slice(0, 15);
    const company = LEADS.includes(p.role) ? due.filter((x) => x.d < 0 && !isMine(x.r, p)).slice(0, 12) : [];
    const soon = LEADS.includes(p.role) ? due.filter((x) => x.d >= 0 && x.d <= 3 && !isMine(x.r, p)).slice(0, 8) : [];
    if (!mine.length && !company.length && !soon.length && !only) { skipped.push(p.email); continue; } // nothing to say: the day stays claimed

    const line = (x: any) => `- **${x.r.title}** — ${label(x.r.section, l)}, ${when(x.d, l)}${x.r.data?.owner && !isMine(x.r, p) ? ` (${x.r.data.owner})` : ""}`;
    const parts = [
      TXT.hello[l].replace("{n}", p.full_name ? `, ${String(p.full_name).split(" ")[0]}` : ""),
      `**${TXT.mine[l]}**\n${mine.length ? mine.map(line).join("\n") : TXT.none[l]}`,
      company.length ? `**${TXT.late[l]}**\n${company.map(line).join("\n")}` : "",
      soon.length ? `**${TXT.soon[l]}**\n${soon.map(line).join("\n")}` : "",
    ].filter(Boolean);
    const body = parts.join("\n\n");
    const subject = TXT.subj[l].replace("{k}", items(mine.length + company.length, l));
    const cta = { label: TXT.open[l], url: `${SITE}/reports` };
    if ((APP_ENV === "staging" || APP_ENV === "preview") && blockedRecipients(p.email).length) { skipped.push(`${p.email}: ${APP_ENV} recipient control`); if (key) await releaseKeys(db, [key]); continue; }
    try {
      await transport.sendMail({ from: { name: "AGRON Workspace", address: from }, to: p.email, subject,
        html: renderEmail({ subject, heading: TXT.head[l], body, cta, lang: l, sender: COMPANY }), text: plainText({ body, cta, sender: COMPANY, lang: l }) });
      sent++;
    } catch (e: any) { skipped.push(`${p.email}: ${e?.message || "send failed"}`); if (key) await releaseKeys(db, [key]); await reportError(db, "digest", e, { detail: p.email }); } // not sent: tried again on the next run
  }
  return { ok: true, sent, skipped: skipped.length };
}

/** Smart upload leaves files in `_intake/<user>/` until they are saved or removed; drop anything older than a day (email attachments: 30 days). */
export async function cleanIntake() {
  const st = adminClient().storage.from("files");
  const { data: users } = await st.list("_intake", { limit: 1000 });
  for (const u of users || []) {
    const { data: files } = await st.list(`_intake/${u.name}`, { limit: 1000 });
    const cutoff = Date.now() - (u.name === "mail" ? 30 : 1) * 864e5; // email attachments wait up to 30 days for approval
    const old = (files || []).filter((f: any) => f.id && Date.parse(f.created_at || "") < cutoff).map((f: any) => `_intake/${u.name}/${f.name}`);
    if (old.length) await st.remove(old);
  }
}
