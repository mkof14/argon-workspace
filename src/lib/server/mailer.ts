import nodemailer from "nodemailer";
import { classifySend, type Verdict } from "@/lib/mailerror";

type Mail = { to: string; subject: string; html: string; text: string; replyTo?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[]; messageId?: string };
const transport = () => {
  const user = (process.env.SMTP_USER || "").trim(), pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return { user, t: nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp.gmail.com", port, secure: port === 465, auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 }) };
};

/** Sends one email through the company Gmail account (info@agron1.com) and says exactly what happened. */
export async function sendMailDetailed(o: Mail): Promise<{ ok: boolean; messageId?: string; error?: string; verdict?: Verdict }> {
  const tr = transport(); if (!tr) return { ok: false, error: "Email sending is not configured", verdict: { kind: "retry", reason: "Email sending is not configured" } };
  try {
    const info = await tr.t.sendMail({ from: { name: "AGRON Inc.", address: process.env.SMTP_FROM || tr.user }, to: o.to, subject: o.subject, html: o.html, text: o.text, replyTo: o.replyTo, attachments: o.attachments, messageId: o.messageId, headers: { "X-AGRON-Workspace": "1" } });
    return { ok: true, messageId: info?.messageId || o.messageId || "" };
  } catch (e: any) { return { ok: false, error: e?.message || "Send failed", verdict: classifySend(e || {}) }; }
}
/** Sends one email; returns an error text instead of throwing (internal notices). */
export async function sendMail(o: Mail): Promise<string | null> { const r = await sendMailDetailed(o); return r.ok ? null : r.error; }
