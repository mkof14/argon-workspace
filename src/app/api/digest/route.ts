import nodemailer from "nodemailer";
import { adminClient, currentProfile } from "@/lib/server/supabase";
import { allSections, defaultRules } from "@/config/workspace.config.mjs";
import { dueItems, isMine } from "@/lib/insights";
import { COMPANY, SITE, plainText, renderEmail } from "@/lib/mail";
import { readState } from "@/lib/server/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];
const LEADS = ["owner", "admin", "management"];
const SECS: any[] = allSections() as any[];
const label = (id: string) => SECS.find((s) => s.id === id)?.label?.en || id;
const when = (d: number) => (d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

/**
 * Morning digest. Vercel Cron calls GET daily (Authorization: Bearer CRON_SECRET) and every internal user
 * gets one email with their own deadlines and tasks; leaders also get company-wide overdue items.
 * POST sends the signed-in user their own digest now (button in Reports).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed", { status: 401 });
  await cleanIntake().catch(() => {});
  const st = await readState(adminClient(), "settings").catch(() => null);
  if (st && st.notify?.digest === false) return Response.json({ ok: true, sent: 0, off: true }); // switched off in System → Settings
  return run(null);
}
export async function POST() {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  return run(me.id);
}

async function run(only: string | null) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return new Response("Email sending is not configured (SMTP_PASS)", { status: 501 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Service key missing", { status: 501 });
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

  for (const p of (profiles || []) as any[]) {
    if (only && p.id !== only) continue;
    if (!INTERNAL.includes(p.role) || !p.email) continue;
    // Same visibility the database enforces for this user
    const full = p.role === "owner" || p.role === "admin";
    const readable = new Set(full ? SECS.map((s) => s.id) : rr.filter((r) => r.role === p.role).map((r) => r.section));
    const visible = (recs || []).filter((r: any) => readable.has(r.section) && (!r.controlled || p.us_person));
    const due = dueItems(visible as any, 7);
    const mine = due.filter((x) => isMine(x.r, p)).slice(0, 15);
    const company = LEADS.includes(p.role) ? due.filter((x) => x.d < 0 && !isMine(x.r, p)).slice(0, 12) : [];
    const soon = LEADS.includes(p.role) ? due.filter((x) => x.d >= 0 && x.d <= 3 && !isMine(x.r, p)).slice(0, 8) : [];
    if (!mine.length && !company.length && !soon.length && !only) { skipped.push(p.email); continue; }

    const line = (x: any) => `- **${x.r.title}** — ${label(x.r.section)}, ${when(x.d)}${x.r.data?.owner && !isMine(x.r, p) ? ` (${x.r.data.owner})` : ""}`;
    const parts = [
      `Good morning${p.full_name ? `, ${String(p.full_name).split(" ")[0]}` : ""}. Here is what needs attention today.`,
      mine.length ? `**Your deadlines and tasks**\n${mine.map(line).join("\n")}` : "**Your deadlines and tasks**\nNothing due in the next 7 days.",
      company.length ? `**Overdue across the company**\n${company.map(line).join("\n")}` : "",
      soon.length ? `**Due in the next 3 days**\n${soon.map(line).join("\n")}` : "",
    ].filter(Boolean);
    const body = parts.join("\n\n");
    const subject = `AGRON Workspace · ${mine.length + company.length} item${mine.length + company.length === 1 ? "" : "s"} for today`;
    const cta = { label: "Open AGRON Workspace", url: `${SITE}/reports` };
    try {
      await transport.sendMail({ from: { name: "AGRON Workspace", address: from }, to: p.email, subject,
        html: renderEmail({ subject, heading: "Your morning digest", body, cta, lang: "en", sender: COMPANY }), text: plainText({ body, cta, sender: COMPANY, lang: "en" }) });
      sent++;
    } catch (e: any) { skipped.push(`${p.email}: ${e?.message || "send failed"}`); }
  }
  return Response.json({ ok: true, sent, skipped: skipped.length });
}

/** Smart upload leaves files in `_intake/<user>/` until they are saved or removed; drop anything older than a day (email attachments: 30 days). */
async function cleanIntake() {
  const st = adminClient().storage.from("files");
  const { data: users } = await st.list("_intake", { limit: 1000 });
  for (const u of users || []) {
    const { data: files } = await st.list(`_intake/${u.name}`, { limit: 1000 });
    const cutoff = Date.now() - (u.name === "mail" ? 30 : 1) * 864e5; // email attachments wait up to 30 days for approval
    const old = (files || []).filter((f: any) => f.id && Date.parse(f.created_at || "") < cutoff).map((f: any) => `_intake/${u.name}/${f.name}`);
    if (old.length) await st.remove(old);
  }
}
