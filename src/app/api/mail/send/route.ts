import nodemailer from "nodemailer";
import { currentProfile, userClient } from "@/lib/server/supabase";
import { limit } from "@/lib/server/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"];
const configured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
const emails = (v: any) => String(v || "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

/** GET → is direct sending configured? */
export async function GET() {
  return Response.json({ configured: configured(), from: process.env.SMTP_FROM || process.env.SMTP_USER || null });
}

/** POST → send one branded email through Google Workspace SMTP and log it in Mail center → Sent emails. */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || !INTERNAL.includes(me.role)) return new Response("Not allowed", { status: 403 });
  { const lim = await limit(`mailsend:${me.id}`, 20, 60); if (lim) return lim; }
  if (!configured()) return new Response("SMTP is not configured", { status: 501 });

  const b = await req.json();
  const to = emails(b.to), cc = emails(b.cc);
  if (!to.length) return new Response("Add at least one recipient", { status: 400 });
  if (to.length + cc.length > 50) return new Response("Up to 50 recipients per email", { status: 400 });
  const subject = String(b.subject || "").slice(0, 300);
  const html = String(b.html || "");
  if (!subject || !html || html.length > 500_000) return new Response("Subject and body are required", { status: 400 });

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: (process.env.SMTP_USER || "").trim(), pass: (process.env.SMTP_PASS || "").replace(/\s+/g, "") } /* Google app passwords are shown with spaces; Gmail needs the 16 letters only */,
  });
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const fromName = "AGRON Inc.";
  let status = "Sent", error = "";
  try {
    await transport.sendMail({
      from: { name: fromName, address: fromAddr }, to, cc: cc.length ? cc : undefined,
      replyTo: fromAddr, subject, html, text: String(b.text || ""),
      headers: { "X-AGRON-Workspace": "1" },
    });
  } catch (e: any) { status = "Failed"; error = /535|BadCredentials|Invalid login/i.test(String(e?.message)) ? `Gmail rejected the login for ${process.env.SMTP_USER}: SMTP_PASS in Vercel must be a 16-letter Google app password created while signed in as ${process.env.SMTP_USER} (myaccount.google.com/apppasswords), then redeploy.` : e?.message || "Send failed"; }

  // Log with the user's own session (row-level security applies)
  try {
    await (await userClient()).from("records").insert({
      section: "mail.outbox", title: subject, status, created_by: me.id,
      data: { to: to.join(", "), cc: cc.join(", "), template: String(b.template || ""), sender: me.full_name || me.email, related: String(b.related || ""), html, error: error || undefined },
    });
  } catch {}
  if (status === "Failed") return new Response(error, { status: 502 });
  return Response.json({ ok: true });
}
