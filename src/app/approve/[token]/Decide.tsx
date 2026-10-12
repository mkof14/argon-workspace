"use client";
import { useEffect, useState } from "react";

type View = { status: string; title: string; section: any; record_status: string; details: { label: string; label_ru: string; value: string }[]; note?: string; comment?: string; requested_by: string; approver: string; created_at: string; decided_at?: string; controlled: boolean; url: string; lang: string };
const T = {
  en: { title: "Approval request", from: "Requested by", note: "Note", comment: "Comment (optional)", approve: "Approve", reject: "Reject", confirm_a: "Confirm approval", confirm_r: "Confirm rejection", back: "Back", done_a: "Approved", done_r: "Rejected", done_p: "The requester has been notified by email.", already: "This request is already", expired: "This link has expired. Ask the requester to send it again.", cancelled: "The requester withdrew this request.", open: "Open in Workspace", bad: "This link is not valid.", ctl: "Export-controlled data — US persons only.", wait: "Loading…", sending: "Saving…" },
  ru: { title: "Запрос на согласование", from: "Запросил(а)", note: "Комментарий", comment: "Комментарий (необязательно)", approve: "Согласовать", reject: "Отклонить", confirm_a: "Подтвердить согласование", confirm_r: "Подтвердить отказ", back: "Назад", done_a: "Согласовано", done_r: "Отклонено", done_p: "Автор запроса получил письмо с решением.", already: "Решение уже принято:", expired: "Срок ссылки истёк. Попросите автора отправить запрос снова.", cancelled: "Автор отозвал этот запрос.", open: "Открыть в Workspace", bad: "Ссылка недействительна.", ctl: "Данные под экспортным контролем — только для US persons.", wait: "Загрузка…", sending: "Сохраняю…" },
};
const post = (b: any) => fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

/** Decision page opened from the approval email. Two steps (choose, then confirm) so email link scanners never decide by themselves. */
export default function Decide({ token, preset }: { token: string; preset?: "approved" | "rejected" }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<"approved" | "rejected" | undefined>(preset);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>("");
  useEffect(() => { post({ action: "view", token }).then(async (r) => (r.ok ? setV(await r.json()) : setErr(await r.text()))).catch((e) => setErr(e.message)); }, [token]);
  const t = T[(v?.lang === "ru" || v?.lang === "uk" ? "ru" : (typeof navigator !== "undefined" && navigator.language?.startsWith("ru") ? "ru" : "en")) as "en" | "ru"];
  const ru = t === T.ru;
  const go = async () => {
    if (!pick) return; setBusy(true);
    const r = await post({ action: "decide", token, decision: pick, comment });
    if (r.ok) setDone(pick); else setErr(await r.text());
    setBusy(false);
  };
  const final = done || (v && v.status !== "pending" ? v.status : "");
  return (
    <div className="login"><div className="box approve">
      <div className="brand"><img src="/logo-full.webp" alt="AGRON" /></div>
      {!v && !err && <p className="faint">{t.wait}</p>}
      {err && !v && <p className="intake-err">{t.bad} {err}</p>}
      {v && <>
        <div><div className="faint" style={{ fontSize: 13.5 }}>{t.title} · {ru ? v.section?.ru || v.section?.en : v.section?.en}</div>
          <h2 style={{ margin: "4px 0 0" }}>{v.title}</h2></div>
        <dl className="approve-dl">
          <div><dt>{t.from}</dt><dd>{v.requested_by} · {v.created_at.slice(0, 10)}</dd></div>
          {v.details.map((d) => <div key={d.label}><dt>{ru ? d.label_ru : d.label}</dt><dd>{d.value}</dd></div>)}
          {v.note && <div><dt>{t.note}</dt><dd>{v.note}</dd></div>}
        </dl>
        {v.controlled && <p className="chip c-warn" style={{ margin: 0 }}>{t.ctl}</p>}
        {final ? <div className={`sys-msg ${final === "approved" ? "ok" : "bad"}`}>
            <b>{final === "approved" ? t.done_a : final === "rejected" ? t.done_r : final === "expired" ? t.expired : final === "cancelled" ? t.cancelled : `${t.already} ${final}`}</b>
            {done ? <> {t.done_p}</> : v.comment ? <> {v.comment}</> : null}</div>
          : !pick ? <div className="approve-btns">
              <button className="btn primary" onClick={() => setPick("approved")}>✓ {t.approve}</button>
              <button className="btn" onClick={() => setPick("rejected")}>✗ {t.reject}</button></div>
          : <div style={{ display: "grid", gap: 10 }}>
              <label className="field"><span>{t.comment}</span><textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
              <div className="approve-btns">
                <button className={`btn ${pick === "approved" ? "primary" : "danger"}`} disabled={busy} onClick={go}>{busy ? t.sending : pick === "approved" ? t.confirm_a : t.confirm_r}</button>
                <button className="btn ghost" disabled={busy} onClick={() => setPick(undefined)}>{t.back}</button></div>
              {err && <p className="intake-err">{err}</p>}
            </div>}
        <a className="linkbtn" href={v.url}>{t.open}</a>
      </>}
    </div></div>
  );
}
