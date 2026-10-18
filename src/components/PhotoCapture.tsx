"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, findSection } from "./App";
import { t, tx, type Lang } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { store, type Rec } from "@/lib/store";
import { matchPO } from "@/lib/photo";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Mode = "receipt" | "card" | "delivery";
const MODES: Record<Mode, { sec: string; icon: string; t: T4; s: T4; fields: string[] }> = {
  receipt: { sec: "finance.expenses", icon: "receipt", t: L("Receipt → expense", "Чек → расход", "Чек → витрата", "إيصال ← مصروف"), s: L("Amount, currency and category are read from the photo", "Сумма, валюта и категория читаются с фото", "Сума, валюта й категорія читаються з фото", "يُقرأ المبلغ والعملة والفئة من الصورة"), fields: ["amount", "currency", "category", "requester", "notes"] },
  card: { sec: "marketing.leads", icon: "contact", t: L("Business card → lead", "Визитка → лид", "Візитка → лід", "بطاقة عمل ← عميل محتمل"), s: L("Name, company, email, phone and country", "Имя, компания, почта, телефон и страна", "Ім'я, компанія, пошта, телефон і країна", "الاسم والشركة والبريد والهاتف والدولة"), fields: ["contact", "email", "country", "source", "notes"] },
  delivery: { sec: "operations.procurement", icon: "truck", t: L("Delivery note → order received", "Накладная → заказ получен", "Накладна → замовлення отримано", "إشعار تسليم ← استلام الطلب"), s: L("Finds the open purchase order and marks it received", "Находит открытый заказ и отмечает его полученным", "Знаходить відкрите замовлення й позначає його отриманим", "يجد أمر الشراء المفتوح ويعلّمه مستلماً"), fields: ["vendor", "item", "qty", "notes"] },
};
const api = (body: any) => fetch("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** A phone photo shrunk to 1600 px JPEG: faster upload and fewer AI tokens, still readable. */
async function shrink(file: File): Promise<File> {
  if (!/^image\//.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

/** Photo → record: a receipt becomes an expense, a business card a lead, a delivery note marks the purchase order received. */
export default function PhotoCapture({ onClose }: { onClose: () => void }) {
  const { lang, access, toast, reload } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [mode, setMode] = useState<Mode | null>(null); const [step, setStep] = useState<"pick" | "read" | "ready" | "saving" | "done">("pick");
  const [file, setFile] = useState<File | null>(null); const [path, setPath] = useState(""); const [p, setP] = useState<any>(null); const [err, setErr] = useState("");
  const [pos, setPos] = useState<{ r: Rec; score: number }[]>([]); const [po, setPo] = useState(""); const [saved, setSaved] = useState<{ section: string; id: string } | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const can = (m: Mode) => access.write.has(MODES[m].sec);

  const start = (m: Mode) => { setMode(m); setErr(""); inp.current?.click(); };
  const read = async (f0: File) => {
    if (!mode) return; setErr(""); setStep("read");
    try {
      if (DEMO) throw new Error(t("ai_demo", lang));
      const f = await shrink(f0); setFile(f);
      const s = await api({ action: "sign", name: f.name, size: f.size }); if (!s.ok) throw new Error(await s.text());
      const { path, token } = await s.json(); setPath(path);
      const { error } = await sb().storage.from("files").uploadToSignedUrl(path, token, f, { contentType: f.type }); if (error) throw error;
      const r = await api({ action: "analyze", path, name: f.name, type: f.type, lang, mode }); if (!r.ok) throw new Error(await r.text());
      const j = await r.json(); if (j.unsupported) throw new Error("Unsupported file");
      setP(j);
      if (mode === "delivery") { const m = matchPO(j.data || {}, (await store.list("operations.procurement")).map((x) => ({ ...store.original(x), updated_at: x.updated_at }) as Rec) as any); setPos(m as any); setPo(m[0]?.r.id || ""); }
      setStep("ready");
    } catch (e: any) { setErr(e?.message || "Error"); setStep("pick"); }
  };
  const save = async () => {
    if (!mode || !p) return; setStep("saving");
    try {
      if (mode === "delivery") {
        const r = (await store.list("operations.procurement")).find((x) => x.id === po); if (!r) throw new Error(T(L("Choose the purchase order", "Выберите заказ", "Виберіть замовлення", "اختر أمر الشراء")));
        const o = store.original(r); const note = [o.data?.notes, `Delivery note ${new Date().toISOString().slice(0, 10)}: ${p.data?.notes || p.summary || ""}`].filter(Boolean).join("\n\n");
        await store.save({ ...o, status: "Received", data: { ...o.data, defects: Number(p.data?.defects) || o.data?.defects || 0, notes: note.slice(0, 4000), received_qty: Number(p.data?.qty) || o.data?.qty } });
        if (file) await store.upload(`operations.procurement/${r.id}`, file).catch(() => {});
        if (path) api({ action: "discard", path }).catch(() => {});
        setSaved({ section: "operations.procurement", id: r.id });
      } else {
        const r = await api({ action: "save", path, name: file?.name, section: MODES[mode].sec, title: p.title, status: p.status, data: p.data, controlled: false });
        if (!r.ok) throw new Error(await r.text()); const j = await r.json(); setSaved({ section: j.section, id: j.id });
      }
      setStep("done"); reload(); toast(T(L("Saved", "Сохранено", "Збережено", "تم الحفظ")));
    } catch (e: any) { setErr(e?.message || "Error"); setStep("ready"); }
  };
  const close = () => { if (path && step !== "done") api({ action: "discard", path }).catch(() => {}); onClose(); };
  const sec = mode ? findSection(MODES[mode].sec) : null;
  const set = (k: string, v: any) => setP({ ...p, data: { ...(p?.data || {}), [k]: v } });

  return <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="Photo">
    <div className="scrim" onClick={() => step !== "read" && close()} />
    <div className="modal card intake ph">
      <div className="card-h toolbar"><h2><Icon n="image" />{T(L("Photo → record", "Фото → запись", "Фото → запис", "صورة ← سجل"))}</h2><button className="iconbtn" style={{ marginInlineStart: "auto" }} onClick={close} disabled={step === "read"} aria-label="×">×</button></div>
      <input ref={inp} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) read(f); }} />
      <div className="card-b" style={{ display: "grid", gap: 12 }}>
        {step === "pick" && <div className="ph-modes">{(Object.keys(MODES) as Mode[]).map((m) => <button key={m} className="ph-mode" disabled={!can(m)} onClick={() => start(m)}><Icon n={MODES[m].icon} /><b>{T(MODES[m].t)}</b><small className="faint">{T(MODES[m].s)}</small></button>)}</div>}
        {step === "read" && <div className="faint">{T(L("Reading the photo…", "Читаю фото…", "Читаю фото…", "أقرأ الصورة…"))}</div>}
        {err && <div className="neg">{err}</div>}
        {(step === "ready" || step === "saving") && p && mode && <>
          <div className="field"><label>{T(L("Title", "Название", "Назва", "العنوان"))}</label><input className="input" value={p.title || ""} onChange={(e) => setP({ ...p, title: e.target.value })} /></div>
          <div className="fgrid">{MODES[mode].fields.map((k) => { const f = sec?.fields.find((x: any) => x.key === k); if (!f) return null; const v = p.data?.[k] ?? "";
            return <div key={k} className={`field ${f.type === "long" ? "wide" : ""}`}><label>{tx(f.label, lang as Lang)}</label>
              {f.type === "select" ? <select className="input" value={v} onChange={(e) => set(k, e.target.value)}><option value="" />{f.options.map((o: string) => <option key={o}>{o}</option>)}</select>
                : f.type === "long" ? <textarea className="input" rows={3} value={v} onChange={(e) => set(k, e.target.value)} />
                : <input className="input" type={f.type === "number" || f.type === "money" ? "number" : "text"} value={v} onChange={(e) => set(k, f.type === "number" || f.type === "money" ? Number(e.target.value) : e.target.value)} />}</div>; })}
            {mode === "delivery" && <div className="field"><label>{T(L("Rejected on receipt, units", "Брак при приёмке, шт.", "Брак під час приймання, шт.", "مرفوض عند الاستلام"))}</label><input className="input" type="number" min={0} value={p.data?.defects ?? ""} onChange={(e) => set("defects", Number(e.target.value))} /></div>}
          </div>
          {mode === "delivery" && <div className="field"><label>{T(L("Purchase order", "Заказ поставщику", "Замовлення постачальнику", "أمر الشراء"))}</label>
            {pos.length ? <select className="input" value={po} onChange={(e) => setPo(e.target.value)}>{pos.map((x) => <option key={x.r.id} value={x.r.id}>{x.r.title} · {x.r.data?.vendor} · {x.r.status}</option>)}</select>
              : <small className="neg">{T(L("No open purchase order matches this delivery. Create the order first or attach the photo to it by hand.", "Ни один открытый заказ не подходит к этой накладной. Сначала создайте заказ или приложите фото к нему вручную.", "Жодне відкрите замовлення не підходить до цієї накладної. Спершу створіть замовлення або прикладіть фото вручну.", "لا يطابق أي أمر شراء مفتوح هذا التسليم. أنشئ الأمر أولاً أو أرفق الصورة يدوياً."))}</small>}</div>}
          {p.summary && <small className="faint">{p.summary}</small>}
          <div className="toolbar"><button className="btn primary" disabled={step === "saving" || (mode === "delivery" && !po)} onClick={save}><Icon n="check" />{step === "saving" ? "…" : mode === "delivery" ? T(L("Mark received", "Отметить полученным", "Позначити отриманим", "علّمه مستلماً")) : T(L("Save", "Сохранить", "Зберегти", "حفظ"))}</button>
            <button className="btn ghost" onClick={() => { if (path) api({ action: "discard", path }).catch(() => {}); setStep("pick"); setP(null); setPath(""); }}>{T(L("Another photo", "Другое фото", "Інше фото", "صورة أخرى"))}</button></div>
        </>}
        {step === "done" && saved && <div style={{ display: "grid", gap: 10 }}><b>{T(L("Done.", "Готово.", "Готово.", "تم."))}</b>
          <div className="toolbar"><Link className="btn primary" href={`/${saved.section.replace(".", "/")}?r=${saved.id}`} onClick={onClose}>{T(L("Open the record", "Открыть запись", "Відкрити запис", "افتح السجل"))}</Link><button className="btn" onClick={() => { setStep("pick"); setP(null); setPath(""); setSaved(null); }}>{T(L("Next photo", "Следующее фото", "Наступне фото", "الصورة التالية"))}</button></div></div>}
        <small className="faint">{T(L("The photo is reduced on the phone before upload and read by AI; you check the fields before saving. The photo stays attached to the record.", "Фото уменьшается на телефоне перед отправкой и читается ИИ; вы проверяете поля перед сохранением. Фото остаётся приложенным к записи.", "Фото зменшується на телефоні перед надсиланням і читається ШІ; ви перевіряєте поля перед збереженням. Фото залишається прикладеним до запису.", "تُصغَّر الصورة على الهاتف قبل الرفع ويقرؤها الذكاء الاصطناعي؛ وتراجع الحقول قبل الحفظ. تبقى الصورة مرفقة بالسجل."))}</small>
      </div></div></div>;
}
