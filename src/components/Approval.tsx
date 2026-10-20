"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { APPROVALS, approvalNeeds } from "@/config/approvals";
import type { Rec } from "@/lib/store";

type A = { id: string; status: string; approver_id: string; requested_by: string; note: string | null; comment: string | null; created_at: string; decided_at: string | null; chain_id?: string | null; step?: number; chain_mode?: string; version_id?: string | null; decided_by?: string | null };
type Step = { step: number; label: string | null; people: { id: string; name: string; role: string }[] };
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
  const [steps, setSteps] = useState<Step[] | null>(null); const [mode, setMode] = useState("single"); const [picks, setPicks] = useState<string[]>([]);
  const [chain, setChain] = useState<A[]>([]); const [vlabels, setVlabels] = useState<Record<string, string>>({});
  const name = (id: string) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : "—"; };
  const load = async () => {
    if (DEMO) { setA(null); return; }
    const { data } = await sb().from("approvals").select("*").eq("record_id", rec.id).order("created_at", { ascending: false }).limit(20);
    const rows = (data || []) as A[]; const last = rows[0] || null;
    const ch = last?.chain_id ? rows.filter((x) => x.chain_id === last.chain_id).sort((x, y) => (x.step || 1) - (y.step || 1)) : [];
    setChain(ch); setA(ch.find((x) => x.status === "pending" && x.approver_id === me.id) || ch.find((x) => x.status === "pending") || last);
    const vids = [...new Set(rows.map((x) => x.version_id).filter(Boolean))] as string[];
    if (vids.length) { const { data: vs } = await sb().from("document_versions").select("id,label").in("id", vids); setVlabels(Object.fromEntries((vs || []).map((v: any) => [v.id, v.label]))); }
  };
  useEffect(() => { if (rule) load(); }, [rec.id]); // eslint-disable-line
  if (!rule || a === undefined) return null;

  const open = async () => {
    setForm(true);
    const r = await api({ action: "approvers", record_id: rec.id }); const l = r.ok ? await r.json() : [];
    if (Array.isArray(l)) { setSteps(null); setList(l); if (l.length === 1) setWho(l[0].id); }
    else { setSteps(l.steps || []); setMode(l.mode || "single"); setPicks((l.steps || []).map((s: Step) => (s.people.length === 1 ? s.people[0].id : ""))); setList(l.steps?.[0]?.people || []); }
  };
  const send = async () => {
    if (steps ? picks.some((p) => !p) : !who) return; setBusy(true);
    const r = await api(steps ? { action: "request", record_id: rec.id, approver_ids: picks, note } : { action: "request", record_id: rec.id, approver_id: who, note });
    setBusy(false);
    if (!r.ok) { toast(await r.text(), true); return; }
    const j = await r.json(); toast(j.mail_error ? `${t("appr_sent_nomail", lang)} ${j.mail_error}` : t("appr_sent", lang).replace("{n}", j.approver), !!j.mail_error);
    setForm(false); setNote(""); load();
  };
  const decide = async (decision: "approved" | "rejected" | "changes_requested") => {
    if (decision === "changes_requested" && !comment.trim()) { toast(t("appr_changes_need", lang), true); return; }
    setBusy(true); const r = await api({ action: "decide", id: a!.id, decision, comment }); setBusy(false);
    if (!r.ok) { toast(await r.text(), true); return; }
    toast(decision === "approved" ? t("appr_done_ok", lang) : decision === "changes_requested" ? t("appr_done_ch", lang) : t("appr_done_no", lang)); onChanged();
  };
  const cancel = async () => { await api({ action: "cancel", id: a!.id }); load(); };
  const date = (s: string | null) => (s || "").slice(0, 10);
  const pending = a?.status === "pending";
  const canSend = canWrite && rule.wait.includes(rec.status || "") && !pending;

  return (
    <section className="appr">
      <div className="appr-h"><Icon n="check" /><b>{t("appr_t", lang)}</b>
        {a && <span className={`chip ${a.status === "approved" ? "c-ok" : a.status === "rejected" ? "c-bad" : a.status === "pending" || a.status === "changes_requested" ? "c-warn" : ""}`}>{t(`appr_${a.status}`, lang)}</span>}</div>
      {chain.length > 1 && <ol className="appr-chain" data-chain={chain.length}>{chain.map((x) => <li key={x.id} className={x.status} data-step-status={x.status}><b>{x.step}.</b> {name(x.approver_id)} <span className="chip">{t(`appr_${x.status === "queued" ? "pending" : x.status}`, lang)}{x.status === "queued" ? " …" : ""}</span>{x.decided_at ? <small className="faint"> {date(x.decided_at)}</small> : null}</li>)}</ol>}
      {a?.version_id && <p className="appr-p faint" data-approval-version={vlabels[a.version_id] || ""}>{lang === "ru" ? "Версия" : "Version"} {vlabels[a.version_id] || "—"}{a.version_id !== rec.data?.current_version_id ? (lang === "ru" ? " (не текущая)" : " (not the current version)") : ""}</p>}
      {pending && <p className="appr-p">{t("appr_waiting", lang).replace("{n}", name(a!.approver_id)).replace("{d}", date(a!.created_at))}{a!.note ? ` — «${a!.note}»` : ""}</p>}
      {a && ["approved", "rejected", "changes_requested"].includes(a.status) && <p className="appr-p">{name((a as any).decided_by || a.approver_id)} · {date(a.decided_at)}{a.comment ? ` — «${a.comment}»` : ""}</p>}
      {pending && a!.approver_id === me.id && <div style={{ display: "grid", gap: 8 }}>
        <textarea className="input" rows={2} placeholder={t("appr_comment", lang)} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="toolbar"><button className="btn primary sm" disabled={busy} onClick={() => decide("approved")}><Icon n="check" />{t("appr_approve", lang)}</button>
          <button className="btn sm" disabled={busy} onClick={() => decide("changes_requested")}><Icon n="edit" />{t("appr_changes", lang)}</button>
          <button className="btn sm danger" disabled={busy} onClick={() => decide("rejected")}>{t("appr_reject", lang)}</button></div></div>}
      {pending && a!.requested_by === me.id && a!.approver_id !== me.id && <button className="linkbtn" onClick={cancel}>{t("appr_cancel", lang)}</button>}
      {canSend && !form && approvalNeeds(rec.section, rec.data) && <p className="appr-p faint">{t("mk_need_check", lang)}</p>}
      {canSend && !form && !approvalNeeds(rec.section, rec.data) && <><p className="appr-p faint">{t("appr_hint", lang)}</p><button className="btn sm" onClick={open}><Icon n="send" />{t("appr_send", lang)}</button></>}
      {!canSend && !a && canWrite && <p className="appr-p faint">{t("appr_when", lang).replace("{s}", rule.wait.join(" / "))}</p>}
      {form && <div className="appr-form">
        {steps ? steps.map((st, i) => <label key={st.step} className="field" data-step={st.step}><span>{steps.length > 1 ? `${st.step}. ${st.label || t("appr_who", lang)}${mode === "sequential" ? " →" : ""}` : t("appr_who", lang)}</span>
            <select className="input" value={picks[i] || ""} onChange={(e) => setPicks(picks.map((x, j) => (j === i ? e.target.value : x)))}><option value="">—</option>{st.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select>
            {!st.people.length && <small className="faint">{t("appr_none", lang)}</small>}</label>)
          : <label className="field"><span>{t("appr_who", lang)}</span>
          <select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">—</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {steps && rec.data?.version && <p className="faint" style={{ margin: 0 }}>{lang === "ru" ? `Согласуется именно версия ${rec.data.version}.` : `Approval is for version ${rec.data.version} exactly.`}</p>}
        {!steps && !list.length && <p className="faint" style={{ margin: 0 }}>{t("appr_none", lang)}</p>}
        <label className="field"><span>{t("appr_note", lang)}</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="toolbar"><button className="btn primary sm" disabled={busy || (steps ? picks.some((p) => !p) : !who)} onClick={send}><Icon n="send" />{busy ? "…" : t("appr_go", lang)}</button>
          <button className="btn ghost sm" onClick={() => setForm(false)}>{t("cancel", lang)}</button></div>
      </div>}
    </section>
  );
}
