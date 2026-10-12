import nodemailer from "nodemailer";
import { currentProfile } from "@/lib/server/supabase";
import { COMPANY, plainText, renderEmail } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin → System → "Check email": logs in to Gmail SMTP and sends a test email to the signed-in admin.
 * Returns a plain explanation of what is wrong, never the password itself.
 */
export async function POST() {
  const me = await currentProfile();
  if (!me || !["owner", "admin"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  const user = (process.env.SMTP_USER || "").trim(), pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const hint = (code: string, message: string) => Response.json({ ok: false, code, message }, { status: 200 });
  if (!user) return hint("no_user", "SMTP_USER is not set in Vercel.");
  if (!pass) return hint("no_pass", "SMTP_PASS is not set in Vercel (or the site was not redeployed after adding it).");
  if (!/^[a-z]{16}$/i.test(pass)) return hint("format", `SMTP_PASS is ${pass.length} characters long. A Google app password is exactly 16 letters — this looks like a regular password or a partial copy.`);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com", port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass },
  });
  try { await transport.verify(); }
  catch (e: any) {
    const m = String(e?.message || "");
    if (/535|BadCredentials|Invalid login/i.test(m)) return hint("rejected", `Gmail rejected the login for ${user}. The 16-letter app password does not belong to this account or was revoked. Create a new one at myaccount.google.com/apppasswords while signed in as ${user}, save it as SMTP_PASS in Vercel, then redeploy.`);
    return hint("connect", `Could not connect to Gmail: ${m.slice(0, 300)}`);
  }
  try {
    const body = `This is a test email from AGRON Workspace.\n\nIf you can read it, email sending works: the morning digest and Mail center will deliver from ${user}.`;
    await transport.sendMail({ from: { name: "AGRON Inc.", address: process.env.SMTP_FROM || user }, to: me.email, subject: "AGRON Workspace — email test",
      html: renderEmail({ subject: "AGRON Workspace — email test", heading: "Email sending works", body, cta: null, lang: "en", sender: COMPANY }),
      text: plainText({ body, cta: null, sender: COMPANY, lang: "en" }) });
  } catch (e: any) { return hint("send", `Login worked, but sending failed: ${String(e?.message || "").slice(0, 300)}`); }
  return Response.json({ ok: true, code: "ok", message: `Login accepted. A test email was sent to ${me.email}.` });
}
