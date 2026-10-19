import { sendMail } from "./mailer";
import { pushTo } from "./push";
import { claimKeys, releaseKeys } from "./state";
import { reportError } from "./errors";
import { renderEmail, SITE } from "@/lib/mail";

/**
 * Critical operational alerts to owners and administrators (e-mail + phone): a job gave up, a backup failed,
 * an e-mail delivery is uncertain, a scheduled run was missed. Each alert key fires at most once per `repeatDays`.
 */
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export async function alertAdmins(db: any, a: { key: string; subject: string; lines: string[]; repeatDays?: number; link?: string }) {
  const claimed = await claimKeys(db, [{ key: `alert|${a.key}`, repeat: a.repeatDays ?? 1 }]).catch(() => new Set<string>());
  if (!claimed.size) return 0;
  const { data: ppl } = await db.from("profiles").select("id,email,lang,role,disabled").in("role", ["owner", "admin"]);
  const to = (ppl || []).filter((p: any) => p.email && !p.disabled);
  const link = a.link || `${SITE}/admin/system?tab=ops`;
  const html = `<ul style="padding-left:18px;font-size:15px;line-height:1.6;color:#2A3440">${a.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p style="font-size:14px;color:#5B6875"><a href="${link}">Open Operations in Workspace</a></p>`;
  let sent = 0;
  for (const p of to) {
    const err = await sendMail({ to: p.email, subject: a.subject, html: renderEmail({ subject: a.subject, heading: a.subject, body: "", html, lang: "en", sender: null }), text: a.lines.map((l) => `- ${l}`).join("\n") + `\n\n${link}` });
    if (!err) sent++; else await reportError(db, "alerts", err, { detail: a.subject });
  }
  await pushTo(db, to.map((p: any) => p.id), () => ({ title: a.subject, body: a.lines[0] || "", url: "/admin/system?tab=ops", tag: `alert-${a.key}` })).catch(() => 0);
  if (!sent && to.length) await releaseKeys(db, [`alert|${a.key}`]); // nobody got it: try again next time
  return sent;
}
