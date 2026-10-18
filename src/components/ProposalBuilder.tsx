"use client";
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { markdownToPdf } from "@/lib/pdf";
import { TERMS, nextNumber, proposalMarkdown, termsText, type PLang } from "@/lib/proposal";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const CONFIGS = ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ", "Custom"];

/** Inside a deal: a commercial proposal with prices from the price list, saved as a record with its PDF. */
export default function ProposalBuilder({ deal, onDone }: { deal: Rec; onDone: () => void }) {
  const { lang, me, access, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [open, setOpen] = useState(false);
  const [prices, setPrices] = useState<Rec[]>([]);
  const [used, setUsed] = useState<string[]>([]);
  const [client, setClient] = useState<Rec | null>(null);
  const d = deal.data || {};
  const [f, setF] = useState(() => ({
    config: CONFIGS.includes(d.config) ? d.config : "C40 Base", qty: 1, currency: d.currency || "USD", unit: Number(d.value) || 0, discount: 0,
    leaseOn: false, leaseMonth: 0, term: 36, terms: "30/40/30", weeks: 12, valid: 30, warranty: "", site: "", contact: "", need: "",
    plang: (lang === "ru" || lang === "uk" ? lang : "en") as PLang, moveDeal: ["Lead", "Qualified"].includes(deal.status || ""),
  }));
  const [busy, setBusy] = useState("");
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    if (access.read.has("sales.pricelist")) store.list("sales.pricelist").then(setPrices).catch(() => {});
    store.list("sales.proposals").then((r) => setUsed(r.map((x) => x.data?.number).filter(Boolean))).catch(() => {});
    if (d.client_ref) store.listMany(["sales.clients"]).then((r) => setClient(r.find((x) => x.id === d.client_ref) || null)).catch(() => {});
  }, [open]); // eslint-disable-line
  // Price list: the active line for this configuration and currency
  const line = useMemo(() => prices.find((p) => p.status === "Active" && p.data?.config === f.config && (p.data?.currency || "USD") === f.currency) || prices.find((p) => p.status === "Active" && p.data?.config === f.config), [prices, f.config, f.currency]);
  useEffect(() => {
    if (!line) return;
    setF((x) => ({ ...x, unit: Number(line.data?.list_price) || x.unit, leaseMonth: Number(line.data?.lease_month) || x.leaseMonth, currency: line.data?.currency || x.currency }));
  }, [line?.id]); // eslint-disable-line
  useEffect(() => { if (client) setF((x) => ({ ...x, contact: x.contact || client.data?.contact || "", site: x.site || client.data?.vessel || "" })); }, [client?.id]); // eslint-disable-line

  const today = new Date().toISOString().slice(0, 10);
  const number = nextNumber(used, new Date().getUTCFullYear());
  const doc = proposalMarkdown({
    number, date: today, client: store.original(deal).data?.client || client?.title || deal.title, contact: f.contact, site: f.site, country: d.country,
    config: f.config, qty: f.qty, unit: f.unit, discount: f.discount, currency: f.currency, lease: f.leaseOn ? { month: f.leaseMonth, term: f.term } : null,
    terms: f.terms, delivery_weeks: f.weeks, valid_days: f.valid, warranty: f.warranty, need: f.need, notes: line ? String(store.original(line).data?.notes || "") : "",
    sender: { name: me.full_name || me.email, title: me.title || undefined, email: me.email },
  }, f.plang);
  const title = `${number} · StarDome ${f.config} · ${store.original(deal).data?.client || deal.title}`;
  const pdfName = `AGRON_${number}_${f.config.replace(/\s+/g, "-")}`;
  const canSave = access.write.has("sales.proposals");

  const create = async () => {
    if (!f.unit) { toast(T(L("Set the unit price", "Укажите цену за единицу", "Вкажіть ціну за одиницю", "حدد سعر الوحدة")), true); return; }
    setBusy("save");
    try {
      const rec = await store.save({ section: "sales.proposals", title, status: "Draft", data: {
        deal_ref: deal.id, number, client: store.original(deal).data?.client || deal.title, config: f.config, qty: f.qty, unit_price: f.unit, discount: f.discount, value: doc.total, currency: f.currency,
        lease_month: f.leaseOn ? doc.lease : undefined, payment_terms: termsText(f.terms, f.plang), delivery: `${f.weeks} weeks`, valid_until: doc.valid_until, language: f.plang.toUpperCase(), document: doc.md,
      } });
      const blob = await markdownToPdf(doc.md, { title, filename: pdfName, blob: true });
      if (blob) await store.upload(`sales.proposals/${rec.id}`, new File([blob], `${pdfName}.pdf`, { type: "application/pdf" })).catch(() => {});
      if (f.moveDeal && ["Lead", "Qualified"].includes(deal.status || "")) await store.save({ ...deal, status: "Proposal" }).catch(() => {});
      toast(T(L("Proposal created — send it for approval, then to the client", "КП создано — отправьте на согласование, затем клиенту", "КП створено — надішліть на погодження, потім клієнту", "تم إنشاء العرض — أرسله للموافقة ثم للعميل")));
      setOpen(false); onDone();
      location.href = `/sales/proposals?r=${rec.id}`;
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  const pdf = async () => { setBusy("pdf"); try { await markdownToPdf(doc.md, { title, filename: pdfName }); } catch (e: any) { toast(e.message || "PDF error", true); } finally { setBusy(""); } };

  if (!open) return <section className="appr"><div className="appr-h"><Icon n="file" /><b>{T(L("Commercial proposal", "Коммерческое предложение", "Комерційна пропозиція", "العرض التجاري"))}</b></div>
    <div className="toolbar"><button className="btn primary sm" onClick={() => setOpen(true)}><Icon n="spark" />{T(L("Make a proposal", "Сформировать КП", "Сформувати КП", "إعداد عرض"))}</button>
      <small className="faint">{T(L("Prices from the price list, PDF in the company style, saved to Proposals", "Цены из прайс-листа, PDF в фирменном стиле, сохраняется в «КП и расчёты»", "Ціни з прайс-листа, PDF у фірмовому стилі, зберігається в «КП та розрахунки»", "أسعار من القائمة وPDF بهوية الشركة ويُحفظ في العروض"))}</small></div></section>;

  const num = (k: string, label: T4, extra: any = {}) => <div className="field"><label>{T(label)}</label><input className="input mono" type="number" value={(f as any)[k]} onChange={(e) => set(k, Number(e.target.value))} {...extra} /></div>;
  return <section className="appr prop-b">
    <div className="appr-h"><Icon n="file" /><b>{T(L("Commercial proposal", "Коммерческое предложение", "Комерційна пропозиція", "العرض التجاري"))} · {number}</b>
      <button className="btn ghost sm" style={{ marginInlineStart: "auto" }} onClick={() => setOpen(false)}>{T(L("Close", "Закрыть", "Закрити", "إغلاق"))}</button></div>
    <div className="fgrid">
      <div className="field"><label>{T(L("Configuration", "Конфигурация", "Конфігурація", "التهيئة"))}</label><select className="input" value={f.config} onChange={(e) => set("config", e.target.value)}>{CONFIGS.map((c) => <option key={c}>{c}</option>)}</select>
        <span className="hint">{line ? T(L("Price from the price list", "Цена из прайс-листа", "Ціна з прайс-листа", "السعر من القائمة")) : T(L("Not in the price list — enter the price", "Нет в прайс-листе — введите цену", "Немає в прайс-листі — введіть ціну", "غير موجود في القائمة — أدخل السعر"))}</span></div>
      {num("qty", L("Quantity", "Количество", "Кількість", "الكمية"), { min: 1 })}
      <div className="field"><label>{T(L("Currency", "Валюта", "Валюта", "العملة"))}</label><select className="input" value={f.currency} onChange={(e) => set("currency", e.target.value)}>{["USD", "AED", "EUR"].map((c) => <option key={c}>{c}</option>)}</select></div>
      {num("unit", L("Unit price", "Цена за единицу", "Ціна за одиницю", "سعر الوحدة"), { min: 0 })}
      {num("discount", L("Discount, %", "Скидка, %", "Знижка, %", "الخصم ٪"), { min: 0, max: 100 })}
      <div className="field"><label>{T(L("Payment terms", "Условия оплаты", "Умови оплати", "شروط الدفع"))}</label><select className="input" value={f.terms} onChange={(e) => set("terms", e.target.value)}>{TERMS.map((k) => <option key={k} value={k}>{termsText(k, (lang === "ru" || lang === "uk" ? lang : "en") as PLang)}</option>)}</select></div>
      {num("weeks", L("Delivery, weeks", "Срок поставки, недель", "Строк постачання, тижнів", "التسليم (أسابيع)"), { min: 1 })}
      {num("valid", L("Valid, days", "Действует, дней", "Дійсна, днів", "صالح (أيام)"), { min: 1 })}
      <div className="field"><label>{T(L("Contact person", "Контактное лицо", "Контактна особа", "جهة الاتصال"))}</label><input className="input" value={f.contact} onChange={(e) => set("contact", e.target.value)} /></div>
      <div className="field"><label>{T(L("Site", "Объект", "Об'єкт", "الموقع"))}</label><input className="input" value={f.site} onChange={(e) => set("site", e.target.value)} /></div>
      <div className="field"><label>{T(L("Warranty (optional)", "Гарантия (по желанию)", "Гарантія (за бажанням)", "الضمان (اختياري)"))}</label><input className="input" value={f.warranty} onChange={(e) => set("warranty", e.target.value)} /></div>
      <div className="field"><label>{T(L("Document language", "Язык документа", "Мова документа", "لغة المستند"))}</label><select className="input" value={f.plang} onChange={(e) => set("plang", e.target.value)}><option value="en">English</option><option value="ru">Русский</option><option value="uk">Українська</option></select></div>
      <label className="check wide"><input type="checkbox" checked={f.leaseOn} onChange={(e) => set("leaseOn", e.target.checked)} />{T(L("Add a lease option", "Добавить вариант лизинга", "Додати варіант лізингу", "إضافة خيار التأجير"))}</label>
      {f.leaseOn && <>{num("leaseMonth", L("Lease per month (per unit)", "Лизинг в месяц (за единицу)", "Лізинг на місяць (за одиницю)", "الإيجار الشهري للوحدة"), { min: 0 })}{num("term", L("Lease term, months", "Срок лизинга, мес.", "Строк лізингу, міс.", "مدة التأجير (أشهر)"), { min: 1 })}</>}
      <div className="field wide"><label>{T(L("Client's request (optional, appears in the proposal)", "Запрос клиента (по желанию, попадёт в КП)", "Запит клієнта (за бажанням, потрапить у КП)", "طلب العميل (اختياري، يظهر في العرض)"))}</label><textarea className="input" rows={2} value={f.need} onChange={(e) => set("need", e.target.value)} /></div>
      {["Lead", "Qualified"].includes(deal.status || "") && <label className="check wide"><input type="checkbox" checked={f.moveDeal} onChange={(e) => set("moveDeal", e.target.checked)} />{T(L("Move the deal to Proposal", "Перевести сделку в Proposal", "Перевести угоду в Proposal", "نقل الصفقة إلى Proposal"))}</label>}
    </div>
    {f.discount > 10 && <div className="gate-msg">{T(L("Discount above 10% — send the proposal for approval before it goes to the client.", "Скидка больше 10% — отправьте КП на согласование до отправки клиенту.", "Знижка понад 10% — надішліть КП на погодження до надсилання клієнту.", "خصم يتجاوز 10٪ — أرسل العرض للموافقة قبل إرساله للعميل."))}</div>}
    <details className="prop-prev" open><summary>{T(L("Preview", "Предпросмотр", "Попередній перегляд", "معاينة"))} · <b className="mono">{doc.total.toLocaleString("en-US")} {f.currency}</b></summary>
      <div className="md tpl-paper" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(doc.md) as string) }} /></details>
    <div className="toolbar">
      {canSave && <button className="btn primary" disabled={!!busy} onClick={create}><Icon n="check" />{busy === "save" ? "…" : T(L("Create proposal + PDF", "Создать КП + PDF", "Створити КП + PDF", "إنشاء العرض + PDF"))}</button>}
      <button className="btn" disabled={!!busy} onClick={pdf}><Icon n="pdf" />{busy === "pdf" ? "…" : T(L("Download PDF", "Скачать PDF", "Завантажити PDF", "تنزيل PDF"))}</button>
    </div>
  </section>;
}
