"use client";
// One document's versions: every version kept with its number, file, author, time, change note, review and approval
// state and SHA-256 hash; which one is current, approved, effective or superseded; new version upload (stored and
// hashed by the server — a file is never replaced in place); download of any version you may open (logged); an
// integrity check; a side-by-side comparison of two versions' details; the reviewer's verdict; and, for management,
// the download audit.
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { isExternal, store, type DocVersion, type Rec } from "@/lib/store";
import { personName } from "./PeopleFields";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ST: Record<string, T4> = { none: L("—", "—", "—", "—"), pending: L("approval pending", "на согласовании", "на погодженні", "قيد الموافقة"), approved: L("approved", "согласовано", "погоджено", "موافق عليه"), rejected: L("rejected", "отклонено", "відхилено", "مرفوض"), changes_requested: L("changes requested", "нужны изменения", "потрібні зміни", "تغييرات مطلوبة"), invalidated: L("approval voided by a newer version", "согласование снято новой версией", "погодження знято новою версією", "أُلغيت الموافقة بنسخة أحدث"), in_review: L("in review", "на проверке", "на перевірці", "قيد المراجعة"), reviewed: L("reviewed", "проверено", "перевірено", "تمت المراجعة") };

export default function DocumentPanel({ rec, canWrite, onChanged, onVersions }: { rec: Rec; canWrite: boolean; onChanged?: () => void; onVersions?: (v: DocVersion[]) => void }) {
  const { lang, people, me, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [vs, setVs] = useState<DocVersion[]>([]); const [busy, setBusy] = useState(false); const [cmp, setCmp] = useState<string[]>([]);
  const [major, setMajor] = useState(false); const [note, setNote] = useState(""); const [label, setLabel] = useState("");
  const [log, setLog] = useState<any[] | null>(null); const [review, setReview] = useState("");
  const fileIn = useRef<HTMLInputElement>(null);
  const load = async () => { const v = await store.versions(rec.id).catch(() => []); setVs(v); onVersions?.(v); };
  useEffect(() => { load(); }, [rec.id]); // eslint-disable-line
  const who = (id?: string | null) => personName(people.find((p) => p.id === id)) || "—";
  const current = rec.data?.current_version_id; const approved = rec.data?.approved_version_id;
  const lead = ["owner", "admin", "management"].includes(me.role);
  const reviewer = rec.data?.reviewer_id === me.id || lead;
  const upload = async (f: File | undefined) => {
    if (!f) return; setBusy(true);
    try { const v = await store.uploadVersion(rec.id, f, { major, note: note.trim() || undefined, label: label.trim() || undefined }); toast(`${T(L("Version", "Версия", "Версія", "الإصدار"))} ${v.label}`); setNote(""); setLabel(""); setMajor(false); await load(); onChanged?.(); }
    catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); if (fileIn.current) fileIn.current.value = ""; }
  };
  const open = async (v: DocVersion, mode: "download" | "preview") => { try { const r = await store.openVersion({ version_id: v.id }, mode); window.open(r.url, "_blank", "noopener"); } catch (e: any) { toast(e.message || "Error", true); } };
  const verify = async (v: DocVersion) => { try { const r = await store.verifyVersion(v.id); toast(r.ok ? T(L("The stored file matches its recorded hash", "Файл совпадает с записанным хешем", "Файл збігається із записаним хешем", "الملف يطابق البصمة المسجلة")) : T(L("WARNING: the stored file does not match its recorded hash", "ВНИМАНИЕ: файл не совпадает с записанным хешем", "УВАГА: файл не збігається із записаним хешем", "تحذير: الملف لا يطابق البصمة المسجلة")), !r.ok); await load(); } catch (e: any) { toast(e.message || "Error", true); } };
  const give = async (d: "reviewed" | "changes_requested") => { try { await store.reviewDocument(rec.id, d, review.trim() || undefined); setReview(""); toast(T(L("Review recorded", "Проверка записана", "Перевірку записано", "سُجلت المراجعة"))); await load(); onChanged?.(); } catch (e: any) { toast(e.message || "Error", true); } };
  const pair = cmp.map((id) => vs.find((v) => v.id === id)).filter(Boolean) as DocVersion[];
  const row = (l: T4, f: (v: DocVersion) => string) => { const a = f(pair[0]), b = f(pair[1]); return <tr key={l.en} className={a !== b ? "diff" : ""}><th>{T(l)}</th><td>{a}</td><td>{b}</td></tr>; };
  return <div className="thread doc-panel" data-versions={vs.length}>
    <div className="eyebrow">{T(L("Versions", "Версии", "Версії", "الإصدارات"))}{rec.data?.doc_number ? ` · ${rec.data.doc_number}` : ""}</div>
    {!vs.length && <div className="faint" style={{ fontSize: 13.5 }}>{T(L("No version yet. Upload the first file — it becomes version 0.1 (or 1.0 if you mark it as a major version).", "Версий пока нет. Загрузите первый файл — он станет версией 0.1 (или 1.0, если отметить «основная версия»).", "Версій ще немає. Завантажте перший файл — він стане версією 0.1 (або 1.0, якщо позначити «основна версія»).", "لا إصدار بعد. ارفع أول ملف — يصبح الإصدار 0.1 (أو 1.0 إن حددته إصداراً رئيسياً)."))}</div>}
    <div className="ver-list">{vs.map((v) => <div key={v.id} className={`ver ${v.id === current ? "current" : ""}`} data-version={v.label}>
      <label className="ver-pick" title={T(L("Compare", "Сравнить", "Порівняти", "قارن"))}><input type="checkbox" checked={cmp.includes(v.id)} onChange={(e) => setCmp(e.target.checked ? [...cmp, v.id].slice(-2) : cmp.filter((x) => x !== v.id))} aria-label={`${T(L("Compare", "Сравнить", "Порівняти", "قارن"))} ${v.label}`} /></label>
      <div className="ver-main"><b className="mono">v{v.label}</b> <span>{v.file_name}</span> <small className="faint">{kb(v.size)} · {who(v.author)} · {String(v.created_at).slice(0, 16).replace("T", " ")}</small>
        <div className="ver-tags">{v.id === current && <span className="chip c-info">{T(L("current", "текущая", "поточна", "الحالية"))}</span>}{v.id === approved && <span className="chip c-ok">{T(L("approved version", "утверждённая версия", "погоджена версія", "النسخة المعتمدة"))}</span>}
          {v.effective_date && <span className="chip c-ok">{T(L("effective", "действует с", "чинна з", "سارية من"))} {v.effective_date}</span>}{v.superseded_at && <span className="chip">{T(L("superseded", "заменена", "замінена", "مستبدلة"))}</span>}
          {v.approval_state !== "none" && <span className="chip" data-approval={v.approval_state}>{T(ST[v.approval_state] || ST.none)}{v.approved_by ? ` · ${who(v.approved_by)} ${String(v.approved_at).slice(0, 10)}` : ""}</span>}
          {v.review_state !== "none" && <span className="chip">{T(ST[v.review_state] || ST.none)}</span>}
          {v.verified_at && <span className={`chip ${v.verified_ok ? "c-ok" : "c-bad"}`}>{v.verified_ok ? T(L("hash verified", "хеш проверен", "хеш перевірено", "تم التحقق من البصمة")) : T(L("HASH MISMATCH", "ХЕШ НЕ СОВПАДАЕТ", "ХЕШ НЕ ЗБІГАЄТЬСЯ", "البصمة لا تطابق"))} {String(v.verified_at).slice(0, 10)}</span>}</div>
        {v.change_note && <div className="faint" style={{ fontSize: 13 }}>{v.change_note}</div>}
        <code className="faint ver-hash" title="SHA-256">sha256 {v.sha256.slice(0, 16)}…</code></div>
      <div className="ver-act"><button type="button" className="btn ghost xs" onClick={() => open(v, "preview")}><Icon n="eye" />{T(L("Open", "Открыть", "Відкрити", "فتح"))}</button><button type="button" className="btn ghost xs" onClick={() => open(v, "download")}><Icon n="download" /></button>
        {!isExternal(me.role) && <button type="button" className="btn ghost xs" onClick={() => verify(v)} title={T(L("Check integrity", "Проверить целостность", "Перевірити цілісність", "تحقق من السلامة"))}><Icon n="shield" /></button>}</div></div>)}</div>
    {pair.length === 2 && <div className="tablewrap"><table className="tb ver-cmp"><thead><tr><th /><th>v{pair[0].label}</th><th>v{pair[1].label}</th></tr></thead><tbody>
      {row(L("File", "Файл", "Файл", "الملف"), (v) => v.file_name)}{row(L("Size", "Размер", "Розмір", "الحجم"), (v) => kb(v.size))}{row(L("Author", "Автор", "Автор", "المؤلف"), (v) => who(v.author))}
      {row(L("Uploaded", "Загружена", "Завантажено", "رُفعت"), (v) => String(v.created_at).slice(0, 16).replace("T", " "))}{row(L("Change note", "Что изменено", "Що змінено", "ملاحظة التغيير"), (v) => v.change_note || "—")}
      {row(L("Review", "Проверка", "Перевірка", "المراجعة"), (v) => T(ST[v.review_state] || ST.none))}{row(L("Approval", "Согласование", "Погодження", "الموافقة"), (v) => T(ST[v.approval_state] || ST.none))}
      {row(L("SHA-256", "SHA-256", "SHA-256", "SHA-256"), (v) => v.sha256.slice(0, 24) + "…")}</tbody></table>
      <small className="faint">{T(L("Highlighted rows differ. Open both files to compare their content.", "Выделены отличающиеся строки. Чтобы сравнить содержимое, откройте оба файла.", "Виділено рядки, що відрізняються. Щоб порівняти зміст, відкрийте обидва файли.", "الصفوف المميزة مختلفة. افتح الملفين لمقارنة المحتوى."))}</small></div>}
    {canWrite && <div className="ver-upload">
      <div className="toolbar"><button type="button" className="btn sm" disabled={busy} onClick={() => fileIn.current?.click()}><Icon n="upload" />{vs.length ? T(L("Upload new version", "Загрузить новую версию", "Завантажити нову версію", "رفع نسخة جديدة")) : T(L("Upload the first version", "Загрузить первую версию", "Завантажити першу версію", "رفع النسخة الأولى"))}</button>
        <input ref={fileIn} type="file" hidden onChange={(e) => upload(e.target.files?.[0])} aria-label={T(L("Upload new version", "Загрузить новую версию", "Завантажити нову версію", "رفع نسخة جديدة"))} data-upload-version />
        <label className="chk"><input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} />{T(L("Major version (1.0, 2.0 …)", "Основная версия (1.0, 2.0 …)", "Основна версія (1.0, 2.0 …)", "إصدار رئيسي (1.0، 2.0 …)"))}</label>
        <input className="input xs" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={T(L("or number, e.g. 1.2", "или номер, напр. 1.2", "або номер, напр. 1.2", "أو رقم، مثل 1.2"))} aria-label={T(L("Version number", "Номер версии", "Номер версії", "رقم الإصدار"))} style={{ maxWidth: 140 }} /></div>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={T(L("What changed in this version", "Что изменилось в этой версии", "Що змінилося в цій версії", "ما الذي تغيّر في هذه النسخة"))} aria-label={T(L("Change description", "Описание изменений", "Опис змін", "وصف التغيير"))} /></div>}
    {reviewer && current && rec.status === "In review" && <div className="ver-review"><div className="eyebrow">{T(L("Your review of the current version", "Ваша проверка текущей версии", "Ваша перевірка поточної версії", "مراجعتك للنسخة الحالية"))}</div>
      <textarea className="input" rows={2} value={review} onChange={(e) => setReview(e.target.value)} placeholder={T(L("Review note (required to request changes)", "Замечание (обязательно, чтобы запросить изменения)", "Зауваження (обов'язково, щоб запросити зміни)", "ملاحظة المراجعة (إلزامية لطلب تغييرات)"))} aria-label={T(L("Review note", "Замечание", "Зауваження", "ملاحظة المراجعة"))} />
      <div className="toolbar"><button type="button" className="btn sm" onClick={() => give("reviewed")}><Icon n="check" />{T(L("Reviewed", "Проверено", "Перевірено", "تمت المراجعة"))}</button><button type="button" className="btn ghost sm" onClick={() => give("changes_requested")}><Icon n="refresh" />{T(L("Request changes", "Запросить изменения", "Запросити зміни", "طلب تغييرات"))}</button></div></div>}
    {lead && <details className="doc-log" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !log) store.docAccessLog(rec.id).then(setLog); }}>
      <summary>{T(L("Download audit", "Журнал скачиваний", "Журнал завантажень", "سجل التنزيل"))}</summary>
      {log ? log.length ? <div className="tablewrap"><table className="tb"><tbody>{log.map((l) => <tr key={l.id} className={l.ok ? "" : "denied"}><td className="mono">{String(l.at).slice(0, 16).replace("T", " ")}</td><td>{who(l.user_id)}</td><td>{l.action}</td><td className="mono">{vs.find((v) => v.id === l.version_id)?.label || ""}</td><td>{l.ok ? "✓" : T(L("refused", "отказано", "відмовлено", "مرفوض"))}</td><td className="faint">{l.reason || ""}</td></tr>)}</tbody></table></div>
        : <div className="faint">—</div> : <div className="faint">…</div>}</details>}
  </div>;
}
