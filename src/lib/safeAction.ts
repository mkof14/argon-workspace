// Browser half of the safe-action layer (server half: src/lib/server/actions.ts). The server keeps the proposal,
// the confirmation and the checked result; the record operations themselves go through the ordinary Workspace
// store, so voice and the Assistant use exactly the same business rules as a change made by hand.
import { store } from "@/lib/store";

export type ActOp = { op: "create"; section: string; title: string; status: string | null; data: any } | { op: "update"; id: string; section: string; title: string; status: string | null; data: any; version: number }
  | { op: "comment"; id: string; section: string; body: string } | { op: "delete"; id: string; section: string; version: number };
export type ActResult = { ok: boolean; error?: string; route?: string; note?: boolean; undoable?: boolean; result?: { ops: { op: string; ok: boolean; id?: string; link?: string; title?: string; error?: string }[]; id?: string; link?: string }; question?: string };

async function call(body: any): Promise<any> {
  const r = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(async () => ({ ok: false, error: await r.text().catch(() => "") || r.statusText }));
  if (!r.ok && j.ok !== false) return { ok: false, error: j.error || r.statusText };
  return j;
}

async function runOps(ops: ActOp[]) {
  const out: { ok: boolean; id?: string; error?: string }[] = [];
  for (const o of ops) {
    try {
      if (o.op === "create") { const r = await store.save({ section: o.section, title: o.title, status: o.status, data: o.data } as any); out.push({ ok: true, id: r.id }); }
      else if (o.op === "update") { await store.save({ id: o.id, section: o.section, title: o.title, status: o.status, data: o.data, version: o.version } as any); out.push({ ok: true, id: o.id }); }
      else if (o.op === "comment") { await store.addComment(o.id, o.body); out.push({ ok: true, id: o.id }); }
      else if (o.op === "delete") { await store.remove(o.id); out.push({ ok: true, id: o.id }); }
    } catch (e: any) { out.push({ ok: false, error: e?.message || "error" }); break; } // stop at the first failure
  }
  while (out.length < ops.length) out.push({ ok: false, error: "not done" });
  return out;
}

/** Confirm and carry out a stored proposal (`confirm` = the person's explicit yes). */
export async function runAction(id: string, o: { confirm?: boolean; personId?: string; taskId?: string; lang?: string } = {}): Promise<ActResult> {
  const s = await call({ action: "start", id, confirm: !!o.confirm, personId: o.personId, taskId: o.taskId, lang: o.lang });
  if (!s.ok) return s;
  if (s.route || s.note || !s.ops?.length) return s;
  const results = await runOps(s.ops);
  return call({ action: "complete", id, results, lang: o.lang });
}
/** Turn a Voice Inbox item into a task / reminder / note / follow-up / project item, then carry it out. */
export async function convertInbox(inbox: string, as: string, o: { title?: string; date?: string; personId?: string; project?: string; lang?: string } = {}): Promise<ActResult & { action_id?: string }> {
  const s = await call({ action: "convert", inbox, as, confirm: true, ...o });
  if (!s.ok || s.note || !s.ops?.length) return s;
  const results = await runOps(s.ops);
  return { ...(await call({ action: "complete", id: s.action_id, results, lang: o.lang })), action_id: s.action_id };
}
export async function cancelAction(id: string) { return call({ action: "cancel", id }); }
/** Undo — the server allows it only when the reversal is exact and nobody changed the records since. */
export async function undoAction(id: string, lang?: string): Promise<ActResult> {
  const s = await call({ action: "undo", id, lang });
  if (!s.ok) return s;
  const res = await runOps(s.ops || []);
  if (res.some((r) => !r.ok)) return { ok: false, error: res.find((r) => !r.ok)?.error };
  return call({ action: "undone", id, lang });
}
export const voiceApi = call;
