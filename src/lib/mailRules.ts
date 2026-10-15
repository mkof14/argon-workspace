// Which incoming emails the intake agent files, and which attachments it keeps. Pure, so it is tested directly.
export type Att = { filename?: string; contentType?: string; size?: number };
const KEEP = /^(application\/pdf|image\/(png|jpe?g|webp|gif)|text\/(plain|csv|markdown)|application\/(vnd\.openxmlformats-officedocument\.[\w.]+|msword|vnd\.ms-excel|vnd\.ms-powerpoint|zip))$/i;
export const MAX_FILE = 15 * 1024 * 1024;

/** Newsletters, auto-replies, bounces, our own outgoing mail and no-reply senders are skipped. */
export function skipReason(h: Record<string, string>, from: string, own: string[]): string | null {
  const f = from.toLowerCase();
  if (h["x-agron-workspace"]) return "sent by Workspace";
  if (/^(no-?reply|noreply|mailer-daemon|postmaster|notifications?|bounce)/.test(f.split("@")[0] || "")) return "automatic sender";
  if (h["list-unsubscribe"] || h["list-id"] || /bulk|list|junk/i.test(h["precedence"] || "")) return "newsletter or mailing list";
  if (h["auto-submitted"] && !/^no$/i.test(h["auto-submitted"])) return "automatic reply";
  if (/^(auto(matic)? reply|out of (the )?office|undeliver|delivery status)/i.test(h["subject"] || "")) return "automatic reply";
  if (own.some((o) => f === o.toLowerCase()) && !/^(fwd?|fw):/i.test(h["subject"] || "")) return "our own message";
  return null;
}
/** Attachments worth filing: documents and images, no inline logos or signatures, size limit. */
export function keepFiles<T extends Att & { contentDisposition?: string; related?: boolean }>(atts: T[]): T[] {
  return atts.filter((a) => KEEP.test(a.contentType || "") && (a.size || 0) <= MAX_FILE && !(a.related || a.contentDisposition === "inline") && !/^(image\d*|logo|signature|outlook)/i.test(a.filename || "")).slice(0, 8);
}
/** Plain text of the letter without quoted history and signatures (shorter, cheaper, clearer for AI). */
export function cleanBody(text: string) {
  const lines = String(text || "").replace(/\r/g, "").split("\n"); const out: string[] = [];
  for (const l of lines) { if (/^(On .+wrote:|-----Original Message-----|From: .+|________________)$/i.test(l.trim())) break; if (/^>/.test(l)) continue; out.push(l); }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
}
