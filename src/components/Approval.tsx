"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { APPROVALS } from "@/config/approvals";
import type { Rec } from "@/lib/store";

type A = { id: string; status: string; approver_id: string; requested_by: string; note: string | null; comment: string | null; created_at: string; decided_at: string | null };
const api = (b: any) => fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

/** Approval block inside a record: send for approval, see who decides, decide if it is you. */
export default function Approval({ rec, canWrite, onChanged }: { rec: Rec; canWrite: boolean; onChanged: () => void }) {
  const { lang, me, people, toast } = useApp();
  const rule = APPROVALS[rec.section];
  const [a, setA] = useState<A | null | undefined>(undefined);
  const [form, setForm] = useState(false);
  const [list, setList] = useState<{ id: string; name: string; role: string }[]>([]);
  const [who, setWho] = useState(""); const [note, setNote] = useState(""); const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : "—"; };
  const load = async () => { if (DEMO) { setA(null); return; } const { data } = await sb().from("approvals").select("*").eq("record_id", rec.id).order("created_at", { ascending: false }).limit(1); setA((data?.[0] as A) || null); };
  useEffect(() => { if (rule) load(); }, [rec.id]); // eslint-disable-line
  if (!rule || a === undefined) return null;

  const open = async () => {
    setForm(true);
    const r = await api({ action: "approvers", record_id: rec.id }); const l = r.ok ? await r.json() : [];
    setList(l); if (l.length === 1) setWho(l[0].id);
  };
  const send = async () => {
    if (!who) return; setBusy(true);
    const r = await api({ action: "request", record_id: rec.id, approver_id: who, note });
    setBusy(false);
    if (!r.ok) { toast(await r.text(), true); return; }
    const j = await r.json(); toast(j.mail_error ? `${t("appr_sent_nomail", lang)} ${j.mail_error}` : t("appr_sent", lang).replace("{n}", j.approver), !!j.mail_error);
    setForm(false); setNote(""); load();
  };
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true); const r = await api({ action: "decide", id: a!.id, decision, comment }); setBusy(false);
    if (!r.ok) { toast(await r.text(), true); return; }
    toast(decision === "approved" ? t("appr_done_ok", lang) : t("appr_done_no", lang)); onChanged();
  };
  const cancel = async () => { await api({ action: "cancel", id: a!.id }); load(); };
  const date = (s: string | null) => (s || "").slice(0, 10);
  const pending = a?.status === "pending";
  const canSend = canWrite && rule.wait.includes(rec.status || "") && !pending;

  return (
    <section className="appr">
      <div className="appr-h"><Icon n="check" /><b>{t("appr_t", lang)}</b>
        {a && <span className={`chip ${a.status === "approved" ? "c-ok" : a.status === "rejected" ? "c-bad" : a.status === "pending" ? "c-warn" : ""}`}>{t(`appr_${a.status}`, lang)}</span>}</div>
      {pending && <p className="appr-p">{t("appr_waiting", lang).replace("{n}", name(a!.approver_id)).replace("{d}", date(a!.created_at))}{a!.note ? ` — «${a!.note}»` : ""}</p>}
      {a && ["approved", "rejected"].includes(a.status) && <p className="appr-p">{name(a.approver_id)} · {date(a.decided_at)}{a.comment ? ` — «${a.comment}»` : ""}</p>}
      {pending && a!.approver_id === me.id && <div style={{ display: "grid", gap: 8 }}>
        <textarea className="input" rows={2} placeholder={t("appr_comment", lang)} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="toolbar"><button className="btn primary sm" disabled={busy} onClick={() => decide("approved")}><Icon n="check" />{t("appr_approve", lang)}</button>
          <button className="btn sm danger" disabled={busy} onClick={() => decide("rejected")}>{t("appr_reject", lang)}</button></div></div>}
      {pending && a!.requested_by === me.id && a!.approver_id !== me.id && <button className="linkbtn" onClick={cancel}>{t("appr_cancel", lang)}</button>}
      {canSend && !form && <><p className="appr-p faint">{t("appr_hint", lang)}</p><button className="btn sm" onClick={open}><Icon n="send" />{t("appr_send", lang)}</button></>}
      {!canSend && !a && canWrite && <p className="appr-p faint">{t("appr_when", lang).replace("{s}", rule.wait.join(" / "))}</p>}
      {form && <div className="appr-form">
        <label className="field"><span>{t("appr_who", lang)}</span>
          <select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">—</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {!list.length && <p className="faint" style={{ margin: 0 }}>{t("appr_none", lang)}</p>}
        <label className="field"><span>{t("appr_note", lang)}</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="toolbar"><button className="btn primary sm" disabled={busy || !who} onClick={send}><Icon n="send" />{busy ? "…" : t("appr_go", lang)}</button>
          <button className="btn ghost sm" onClick={() => setForm(false)}>{t("cancel", lang)}</button></div>
      </div>}
    </section>
  );
}
