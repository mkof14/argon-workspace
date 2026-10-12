import nodemailer from "nodemailer";

/** Sends one email through the company Gmail account (info@agron1.com). Returns an error text instead of throwing. */
export async function sendMail(o: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<string | null> {
  const user = (process.env.SMTP_USER || "").trim(), pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  if (!user || !pass) return "Email sending is not configured";
  try {
    const t = nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp.gmail.com", port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass } });
    await t.sendMail({ from: { name: "AGRON Inc.", address: process.env.SMTP_FROM || user }, to: o.to, subject: o.subject, html: o.html, text: o.text, replyTo: o.replyTo, headers: { "X-AGRON-Workspace": "1" } });
    return null;
  } catch (e: any) { return e?.message || "Send failed"; }
}
