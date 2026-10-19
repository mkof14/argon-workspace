// What a failed e-mail send means for a second try. Pure; reads the fields nodemailer puts on its errors.
//  sent: false + retry: true   — the mail server never accepted the message (connection, sign-in, temporary refusal): safe to try again
//  sent: false + retry: false  — refused for good (unknown address, message rejected): trying again will not help
//  uncertain                   — the connection broke after the message was handed over: it may have arrived. A person checks.

export type SendFailure = { code?: string; command?: string; responseCode?: number; message?: string };
export type Verdict = { kind: "retry" | "permanent" | "uncertain"; reason: string };

const BEFORE_DATA = /^(CONN|EHLO|HELO|STARTTLS|AUTH.*|MAIL FROM|RCPT TO|API)$/i;
export function classifySend(e: SendFailure): Verdict {
  const cmd = String(e.command || "").trim(); const code = String(e.code || ""); const rc = Number(e.responseCode || 0);
  // the message was being handed over (or was handed over) and no answer came back: it may have arrived
  if (/^DATA$/i.test(cmd) && !rc) return { kind: "uncertain", reason: e.message || "The connection broke while the message was sent" };
  // nodemailer reports a connection that closed in the middle of a send as command "CONN"; it may have been after the message
  if (/closed unexpectedly|unexpected socket close|socket hang up/i.test(String(e.message || ""))) return { kind: "uncertain", reason: e.message || "Connection closed" };
  if (code === "EENVELOPE" || code === "EMESSAGE") return { kind: rc >= 400 && rc < 500 ? "retry" : "permanent", reason: e.message || code };
  if (code === "EAUTH") return { kind: "retry", reason: "Sign-in to the mail server failed" };
  if (code === "EDNS" || code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ENOTFOUND") return { kind: "retry", reason: e.message || code };
  if (cmd && BEFORE_DATA.test(cmd)) return rc >= 500 ? { kind: "permanent", reason: e.message || `${cmd} ${rc}` } : { kind: "retry", reason: e.message || cmd };
  if (/^DATA$/i.test(cmd) && rc >= 500) return { kind: "permanent", reason: e.message || "Message rejected" };
  if (/^DATA$/i.test(cmd) && rc >= 400) return { kind: "retry", reason: e.message || "Temporarily refused" };
  // anything else (timeout or socket error while or after sending the message): it may have gone out
  return { kind: "uncertain", reason: e.message || code || "No answer from the mail server" };
}
