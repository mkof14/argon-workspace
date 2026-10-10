import nodemailer from "nodemailer";
import { currentProfile, userClient } from "@/lib/server/supabase";

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
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const fromName = me.full_name ? `${me.full_name} · AGRON` : "AGRON";
  let status = "Sent", error = "";
  try {
    await transport.sendMail({
      from: { name: fromName, address: fromAddr }, to, cc: cc.length ? cc : undefined,
      replyTo: me.email || undefined, subject, html, text: String(b.text || ""),
      headers: { "X-AGRON-Workspace": "1" },
    });
  } catch (e: any) { status = "Failed"; error = e?.message || "Send failed"; }

  // Log with the user's own session (row-level security applies)
  try {
    await userClient().from("records").insert({
      section: "mail.outbox", title: subject, status, created_by: me.id,
      data: { to: to.join(", "), cc: cc.join(", "), template: String(b.template || ""), sender: me.full_name || me.email, related: String(b.related || ""), html, error: error || undefined },
    });
  } catch {}
  if (status === "Failed") return new Response(error, { status: 502 });
  return Response.json({ ok: true });
}
