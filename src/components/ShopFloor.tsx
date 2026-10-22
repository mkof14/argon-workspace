"use client";
// Phase 8 — the shop floor (/build), made for a phone at the bench: my work, ready, in progress, blocked, inspection
// and completed today; scan a label (camera where the browser can read codes, or type it); open a work order, follow
// its pinned instruction and checklist, record what was used and installed, add photos, report an issue. Nothing here
// measures people: it lists work, not productivity.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import Attachments from "./Attachments";
import { findSection, useApp } from "./App";
import { mfg, qty } from "@/lib/mfgApi";
import { L, W, type T4 } from "@/lib/mfgText";
import { Act, Err, StatusChip, Wait, day, useT, when } from "./MfgUi";

const GROUPS: [string, T4][] = [["my_work", L("My work", "Моя работа", "Моя робота", "عملي")], ["ready", L("Ready", "Готово к началу", "Готово до початку", "جاهز")], ["in_progress", L("In progress", "В работе", "У роботі", "قيد التنفيذ")],
  ["blocked", L("Blocked", "Заблокировано", "Заблоковано", "معطل")], ["inspection_required", L("Inspection required", "Нужна инспекция", "Потрібна інспекція", "يحتاج فحصًا")], ["completed_today", L("Completed today", "Завершено сегодня", "Завершено сьогодні", "أنجز اليوم")]];

export default function ShopFloor() {
  const T = useT();
  const q = typeof window !== "undefined" ? new URLSearchParams(location.search) : null;
  const [wo, setWo] = useState<string | null>(q?.get("wo") || null);
  const [g, setG] = useState("my_work"); const [data, setData] = useState<any>(null); const [err, setErr] = useState(""); const [tick, setTick] = useState(0);
  useEffect(() => { mfg.queue().then(setData).catch((e) => setErr(e.message)); }, [tick]);
  const open = (id: string | null) => { setWo(id); try { history.replaceState(null, "", id ? `/build?wo=${id}` : "/build"); } catch {} if (!id) setTick((t) => t + 1); };
  return <div className="shopfloor" style={{ display: "grid", gap: 12, minWidth: 0, maxWidth: 760 }}>
    <Scan onWo={open} />
    {wo ? <WorkOrder id={wo} onClose={() => open(null)} /> : <>
      <nav className="dtabs" style={{ ["--dc" as any]: "#0F766E", overflowX: "auto" }} aria-label={T(W.shop)}>
        {GROUPS.map(([k, l]) => <button key={k} data-group={k} className={g === k ? "on" : ""} onClick={() => setG(k)}>{T(l)} <span className="chip mono">{data?.counts?.[k] ?? (data?.[k] || []).length}</span></button>)}
      </nav>
      <Err e={err} />
      {!data ? <Wait /> : <div className="card feed" data-queue={g}>{(data[g] || []).length ? (data[g] || []).map((w: any) => <button key={w.id} className="row" data-wo={w.id} onClick={() => open(w.id)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, textAlign: "start", width: "100%", padding: "12px", borderBottom: "1px solid var(--line, #eee)", minHeight: 56 }}>
        <span style={{ minWidth: 0 }}><b style={{ overflowWrap: "anywhere" }}>{w.operation || w.title}</b><br /><small className="muted mono">{w.number} · {w.unit}</small>
          {w.blocked_reason ? <><br /><small className="neg">{w.blocked_reason}</small></> : null}{w.stale ? <><br /><small className="neg">{T(L("A newer instruction exists — ask to re-pin", "Есть новая инструкция — попросите обновить", "Є нова інструкція — попросіть оновити", "توجد تعليمات أحدث"))}</small></> : null}</span>
        <span style={{ textAlign: "end" }}><StatusChip s={w.status} /><br /><small className="faint">{day(w.planned)}</small></span></button>)
        : <div className="empty" style={{ padding: 16 }}>{T(W.none)}</div>}</div>}
    </>}
  </div>;
}

/** Scan a label (QR or barcode) with the camera where the browser supports it, or type the code. */
function Scan({ onWo }: { onWo: (id: string) => void }) {
  const T = useT(); const router = useRouter(); const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [cam, setCam] = useState(false);
  const vid = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null);
  const canCam = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
  const resolve = async (c: string) => {
    setErr(""); if (!c.trim()) return;
    try { const r = await mfg.resolve(c.trim()); if (!r?.found) { setErr(T(L("Nothing you can open matches this code", "По этому коду нет записей, доступных вам", "За цим кодом немає записів, доступних вам", "لا يوجد ما يمكنك فتحه"))); return; }
      if (r.kind === "work_order" && r.id) onWo(r.id); else router.push(r.link); } catch (e: any) { setErr(e.message); }
  };
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCam(false); };
  useEffect(() => () => stop(), []);
  const start = async () => {
    setErr(""); try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); stream.current = s; setCam(true);
      setTimeout(async () => { if (!vid.current) return; vid.current.srcObject = s; await vid.current.play().catch(() => {});
        const det = new (window as any).BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "data_matrix"] });
        const loop = async () => { if (!stream.current || !vid.current) return; try { const f = await det.detect(vid.current); if (f?.[0]?.rawValue) { stop(); setCode(f[0].rawValue); resolve(f[0].rawValue); return; } } catch {} requestAnimationFrame(loop); };
        loop(); }, 50);
    } catch { setErr(T(L("The camera is not available — type the code instead", "Камера недоступна — введите код", "Камера недоступна — введіть код", "الكاميرا غير متاحة — اكتب الرمز"))); stop(); }
  };
  return <section className="card" style={{ padding: 12, display: "grid", gap: 8 }} data-scan>
    <form onSubmit={(e) => { e.preventDefault(); resolve(code); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input data-scan-input style={{ flex: 1, minWidth: 0, fontSize: 16 }} placeholder={T(W.scan)} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
      <button className="btn" type="submit"><Icon n="search" />{T(W.open)}</button>
      {canCam && !cam && <button className="btn ghost" type="button" data-scan-camera onClick={start}><Icon n="eye" />{T(L("Camera", "Камера", "Камера", "الكاميرا"))}</button>}
    </form>
    {cam && <div style={{ display: "grid", gap: 6 }}><video ref={vid} playsInline muted style={{ width: "100%", maxHeight: 280, background: "#000", borderRadius: 8 }} /><button className="btn ghost sm" onClick={stop}>{T(W.cancel)}</button></div>}
    {err && <small className="neg" role="alert" data-err>{err}</small>}
  </section>;
}

function WorkOrder({ id, onClose }: { id: string; onClose: () => void }) {
  const T = useT(); const { lang } = useApp();
  const [w, setW] = useState<any>(null); const [rec, setRec] = useState<any>(null); const [err, setErr] = useState(""); const [tick, setTick] = useState(0);
  const [check, setCheck] = useState<Record<string, boolean>>({}); const [use, setUse] = useState<Record<string, string>>({}); const [inst, setInst] = useState<Record<string, boolean>>({}); const [pos, setPos] = useState<Record<string, string>>({});
  const [sw, setSw] = useState({ component: "", version: "", checksum: "" }); const [notes, setNotes] = useState(""); const [exc, setExc] = useState(""); const [issue, setIssue] = useState("");
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => { mfg.wo(id).then((x) => { setW(x); setCheck(Object.fromEntries((x.checklist || []).map((c: any) => [c.key, false]))); }).catch((e) => setErr(e.message)); mfg.record(id).then(setRec).catch(() => {}); }, [id, tick]);
  if (err && !w) return <><Err e={err} /><button className="btn ghost" onClick={onClose}><Icon n="back" />{T(W.close)}</button></>;
  if (!w) return <Wait />;
  const done = ["Completed", "Cancelled"].includes(w.status); const started = w.status === "In Progress";
  const payload = () => {
    const consumed = (w.allocated || []).filter((a: any) => !a.serialized && Number(use[a.alloc]) > 0).map((a: any) => ({ item: a.item, qty: Number(use[a.alloc]) }));
    const installed = (w.allocated || []).filter((a: any) => a.serialized && inst[a.alloc]).map((a: any) => ({ item: a.item, serial_id: a.serial_id, serial: a.serial, position: pos[a.alloc] || null }));
    const software = sw.component.trim() && sw.version.trim() ? [{ component: sw.component.trim(), version: sw.version.trim(), checksum: sw.checksum.trim() || null }] : [];
    return { checklist: Object.entries(check).map(([key, d]) => ({ key, done: d })), consumed, installed, software, notes: notes.trim() || null, exception_reason: exc.trim() || null };
  };
  const summary = () => { const p = payload(); return `${w.number}: ${p.checklist.filter((c) => c.done).length}/${p.checklist.length} ✓ · ${p.consumed.map((c: any) => qty(c.qty)).join("+") || "0"} ${T(L("used", "израсходовано", "використано", "مستخدم"))} · ${p.installed.length} ${T(L("installed", "установлено", "встановлено", "مثبت"))}${p.software.length ? ` · ${p.software[0].component} ${p.software[0].version}` : ""}`; };
  const section = findSection("operations.work_orders");
  return <section className="card" data-wo-view={id} style={{ padding: 12, display: "grid", gap: 12, minWidth: 0 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
      <div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow mono">{w.number}</div><h2 style={{ margin: 0, overflowWrap: "anywhere" }}>{w.operation || w.title} <StatusChip s={w.status} /></h2>
        <small className="muted">{w.unit?.number ? <Link href={`/mfg?unit=${w.unit.id}`}>{w.unit.number}</Link> : null} · {w.assignee || "—"} · {day(w.planned)}</small></div>
      <button className="btn ghost sm" onClick={onClose}><Icon n="back" />{T(W.close)}</button>
    </div>
    <Err e={err} />
    {w.blocked_reason && <div className="card" style={{ padding: 10, borderColor: "var(--bad, #c33)" }}><small className="neg">{T(W.block)}: {w.blocked_reason}</small></div>}
    {(w.prerequisites_open || []).length ? <small className="neg" data-prereq>{T(L("Waiting for", "Ждёт", "Чекає", "بانتظار"))}: {(w.prerequisites_open || []).map((p: any) => p.text || p.number || p).join(", ")}</small> : null}
    {(w.documents || []).length ? <section data-wo-docs><b>{T(L("Work instruction (pinned version)", "Инструкция (закреплённая версия)", "Інструкція (закріплена версія)", "تعليمات العمل (الإصدار المثبت)"))}</b>
      <ul style={{ margin: "4px 0", paddingInlineStart: 18 }}>{w.documents.map((d: any, i: number) => <li key={i}><Link href={`/documents?r=${d.doc_ref || d.id}`}>{d.title || d.doc_number || d.doc_ref}</Link> <small className="mono">v{d.version}</small></li>)}</ul>
      {w.stale_documents ? <small className="neg" data-stale>{T(L("A newer approved version exists. Work continues on the pinned version until a manager re-pins it.", "Есть более новая утверждённая версия. Работа идёт по закреплённой, пока руководитель не обновит.", "Є новіша затверджена версія. Робота йде за закріпленою, доки керівник не оновить.", "يوجد إصدار أحدث."))}</small> : null}</section> : null}
    {w.instructions && <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{w.instructions}</p>}
    {w.tools && <small className="muted">{T(L("Tools", "Инструменты", "Інструменти", "الأدوات"))}: {w.tools}</small>}

    {!done && w.can_act && !started && <Act data="wo-start" label={W.start} icon="play" what={`${w.number} · ${w.operation || ""}`} run={() => mfg.start(id)} done={refresh} />}
    {!done && started && w.can_act && <>
      {(w.checklist || []).length ? <section data-checklist style={{ display: "grid", gap: 6 }}><b>{T(L("Checklist", "Чек-лист", "Чек-лист", "قائمة التحقق"))}</b>
        {w.checklist.map((c: any) => <label key={c.key} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" data-check={c.key} style={{ width: 22, height: 22 }} checked={!!check[c.key]} onChange={(e) => setCheck({ ...check, [c.key]: e.target.checked })} /><span style={{ overflowWrap: "anywhere" }}>{c.text}{c.required === false ? "" : " *"}</span></label>)}</section> : null}
      {(w.allocated || []).length ? <section data-materials style={{ display: "grid", gap: 6 }}><b>{T(L("Allocated to this unit", "Зарезервировано под изделие", "Зарезервовано під виріб", "المخصص لهذه الوحدة"))}</b>
        {w.allocated.map((a: any) => <div key={a.alloc} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "center" }} data-alloc={a.number}>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><span className="mono">{a.number}</span> {a.title}{a.serial ? <> · <b className="mono">{a.serial}</b></> : null} <small className="faint">({qty(a.qty)})</small></span>
          {a.serialized ? <span style={{ display: "flex", gap: 6, alignItems: "center" }}><input placeholder={T(L("Position", "Позиция", "Позиція", "الموضع"))} style={{ width: 110 }} value={pos[a.alloc] || ""} onChange={(e) => setPos({ ...pos, [a.alloc]: e.target.value })} />
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" data-install={a.serial} style={{ width: 22, height: 22 }} checked={!!inst[a.alloc]} onChange={(e) => setInst({ ...inst, [a.alloc]: e.target.checked })} />{T(L("Installed", "Установлено", "Встановлено", "مثبت"))}</label></span>
            : <input inputMode="decimal" data-use={a.number} style={{ width: 90 }} placeholder={T(W.qty)} value={use[a.alloc] || ""} onChange={(e) => setUse({ ...use, [a.alloc]: e.target.value })} />}
        </div>)}</section> : null}
      <details><summary>{T(L("Software installed in this step", "ПО, установленное на этом шаге", "ПЗ, встановлене на цьому кроці", "البرمجيات المثبتة"))}</summary>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginTop: 6 }}>
          <input data-sw-component placeholder={T(L("Component", "Компонент", "Компонент", "المكوّن"))} value={sw.component} onChange={(e) => setSw({ ...sw, component: e.target.value })} />
          <input data-sw-version placeholder={T(L("Version", "Версия", "Версія", "الإصدار"))} value={sw.version} onChange={(e) => setSw({ ...sw, version: e.target.value })} />
          <input data-sw-checksum placeholder={T(L("Checksum (optional)", "Контрольная сумма (необяз.)", "Контрольна сума (необов.)", "المجموع الاختباري"))} value={sw.checksum} onChange={(e) => setSw({ ...sw, checksum: e.target.value })} /></div>
        <small className="faint">{T(L("Never enter passwords or keys here.", "Никогда не вводите сюда пароли или ключи.", "Ніколи не вводьте сюди паролі чи ключі.", "لا تدخل كلمات مرور أو مفاتيح هنا."))}</small></details>
      <label className="fld"><span>{T(W.notes)}</span><textarea rows={2} data-wo-notes value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="fld"><span>{T(L("Authorized exception (only if a check cannot be met)", "Разрешённое исключение (если проверку нельзя выполнить)", "Дозволений виняток (якщо перевірку неможливо виконати)", "استثناء مصرح به"))}</span><input data-wo-exception value={exc} onChange={(e) => setExc(e.target.value)} /></label>
      <Act data="wo-complete" label={W.complete} icon="check" what={summary()} run={() => mfg.complete(id, payload())} done={refresh} />
    </>}
    {!done && (w.can_act || w.status === "Blocked") && <Act data={w.status === "Blocked" ? "wo-unblock" : "wo-block"} label={w.status === "Blocked" ? W.unblock : L("Mark blocked", "Отметить блокировку", "Позначити блокування", "وضع علامة معطل")} what={w.number} reason={w.status === "Blocked" ? "optional" : "required"} run={(r) => mfg.block(id, w.status !== "Blocked", r || null)} done={refresh} danger />}
    {w.completed_at && <small className="muted">{T(L("Completed", "Завершено", "Завершено", "أنجز"))} {when(w.completed_at)} · {w.completed_by}</small>}
    {w.unit?.id && <section style={{ display: "grid", gap: 6 }} data-wo-issue><b>{T(W.issue)}</b>
      <textarea rows={2} data-issue-text value={issue} onChange={(e) => setIssue(e.target.value)} placeholder={T(L("What did you find?", "Что обнаружено?", "Що виявлено?", "ماذا وجدت؟"))} />
      {issue.trim().length > 4 && <Act data="wo-issue" label={L("Create issue", "Создать проблему", "Створити проблему", "إنشاء مشكلة")} what={issue} run={() => mfg.ncCreate({ unit: w.unit.id, work_order: id, title: issue.trim().slice(0, 120), description: issue.trim(), severity: "Medium" })} done={() => setIssue("")} />}</section>}
    {section && rec && <section data-wo-evidence><b>{T(W.evidence)}{w.evidence_required ? " *" : ""} <small className="mono">({w.evidence ?? 0})</small></b><Attachments section={section} rec={rec} canWrite={!!w.can_act} title={w.number} /></section>}
    <small className="faint" lang={lang}>{T(L("Workspace lists work, not people's speed: nothing here measures productivity.", "Workspace показывает работу, а не скорость людей: здесь ничего не измеряет производительность.", "Workspace показує роботу, а не швидкість людей: тут ніщо не вимірює продуктивність.", "يعرض Workspace العمل لا سرعة الأشخاص."))}</small>
  </section>;
}
