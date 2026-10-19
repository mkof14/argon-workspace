import { sendMailDetailed } from "./mailer";

/**
 * E-mail to an outside address with a durable delivery state. One idempotency key = at most one send:
 *  - a second call with the same key while the first is sending, or after it was sent, does not send again;
 *  - a send whose outcome is unknown (connection broke after the message was handed over) becomes "uncertain"
 *    and is never resent automatically — an administrator checks the Sent folder and decides (Operations screen).
 * The Message-ID is derived from the key, so a duplicate that slips through anyway is recognisable in mail clients.
 */
export type OutResult = { status: "sent" | "already-sent" | "in-progress" | "uncertain" | "failed" | "permanent"; retry: boolean; detail: string; id?: string };
export async function sendExternal(db: any, m: { idem: string; to: string; subject: string; html: string; text: string; replyTo?: string; queueId?: string }): Promise<OutResult> {
  const { data: c, error } = await db.rpc("outbound_claim", { p_idem: m.idem, p_to: m.to, p_subject: m.subject.slice(0, 300), p_queue: m.queueId || null });
  if (error) return { status: "failed", retry: true, detail: `delivery state: ${error.message}` };
  if (!c.claimed) {
    if (c.status === "sent") return { status: "already-sent", retry: false, detail: `already sent (${c.provider_id || "no id"})`, id: c.id };
    if (c.status === "sending") return { status: "in-progress", retry: true, detail: "another worker is sending it now", id: c.id };
    if (c.status === "uncertain") return { status: "uncertain", retry: false, detail: "delivery uncertain — waiting for an administrator", id: c.id };
    return { status: "permanent", retry: false, detail: `delivery ${c.status}`, id: c.id };
  }
  const messageId = `<${m.idem.replace(/[^A-Za-z0-9.-]/g, ".")}@workspace.agron1.com>`;
  const r = await sendMailDetailed({ to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo, messageId });
  if (r.ok) { await db.rpc("outbound_done", { p_id: c.id, p_status: "sent", p_provider: r.messageId, p_error: null }); return { status: "sent", retry: false, detail: `emailed ${m.to}`, id: c.id }; }
  const v = r.verdict || { kind: "retry" as const, reason: r.error || "" };
  if (v.kind === "uncertain") { await db.rpc("outbound_done", { p_id: c.id, p_status: "uncertain", p_provider: null, p_error: r.error }); return { status: "uncertain", retry: false, detail: `delivery uncertain: ${r.error}`, id: c.id }; }
  await db.rpc("outbound_done", { p_id: c.id, p_status: v.kind === "permanent" ? "cancelled" : "failed", p_provider: null, p_error: r.error });
  return { status: v.kind === "permanent" ? "permanent" : "failed", retry: v.kind === "retry", detail: r.error, id: c.id };
}

/** Administrator decisions on an uncertain delivery: it did arrive (mark sent) or it did not (allow one more send). */
export async function resolveDelivery(db: any, id: string, arrived: boolean, by: string) {
  const { data, error } = await db.from("outbound_messages").update({ status: arrived ? "sent" : "failed", resolved_by: by, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(arrived ? { sent_at: new Date().toISOString() } : {}) }).eq("id", id).eq("status", "uncertain").select("id,queue_id,status");
  if (error) throw new Error(error.message); if (!data?.length) throw new Error("Already resolved");
  return data[0];
}
