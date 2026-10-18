"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/sb";
import type { Rec } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const api = async (b: any) => { const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };

/** Inside a client: personal links to the client portal — orders, documents, invoices and service requests, without an account. */
export default function PortalLinks({ client }: { client: Rec }) {
  const { lang, toast, people } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [list, setList] = useState<any[] | null>(null); const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false);
  const [plang, setPlang] = useState<string>(lang); const [days, setDays] = useState(180);
  const load = () => (DEMO ? Promise.resolve(setList([])) : api({ action: "list", client_id: client.id }).then(setList).catch(() => setList([])));
  useEffect(() => { load(); }, [client.id]); // eslint-disable-line
  if (client.controlled) return null;
  const create = async () => {
    if (DEMO) { toast(T(L("Works on the live site.", "Работает на рабочем сайте.", "Працює на робочому сайті.", "يعمل على الموقع الفعلي.")), true); return; }
    setBusy(true); try { const j = await api({ action: "create", client_id: client.id, lang: plang, days }); setUrl(j.url); await load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => { try { await api({ action: "revoke", id }); await load(); } catch (e: any) { toast(e.message, true); } };
  const who = (id: string) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : "—"; };
  const active = (list || []).filter((x) => !x.revoked_at && Date.parse(x.expires_at) > Date.now());
  return <section className="appr">
    <div className="appr-h"><Icon n="link" /><b>{T(L("Client portal", "Портал клиента", "Портал клієнта", "بوابة العميل"))}</b>{active.length > 0 && <span className="chip c-ok" style={{ marginInlineStart: 8 }}>{active.length}</span>}</div>
    <small className="faint">{T(L("A personal link for the client: order progress, shipping and installation, sent proposals with PDF, invoices, installed systems and service requests. Only these items are shown; notes, prices from the price list and US-persons-only records never are.", "Личная ссылка для клиента: ход заказа, доставка и установка, отправленные КП с PDF, счета, установленные системы и заявки в сервис. Показываются только эти данные; заметки, прайс-лист и записи «только для US persons» — никогда.", "Особисте посилання для клієнта: хід замовлення, доставка та встановлення, надіслані КП з PDF, рахунки, встановлені системи й заявки в сервіс. Показуються лише ці дані; нотатки, прайс-лист і записи «лише для US persons» — ніколи.", "رابط شخصي للعميل: تقدم الطلب والشحن والتركيب والعروض المرسلة مع PDF والفواتير والأنظمة المركّبة وطلبات الصيانة. تُعرض هذه البيانات فقط؛ ولا تُعرض الملاحظات وقائمة الأسعار وسجلات الأشخاص الأمريكيين أبداً."))}</small>
    <div className="toolbar">
      <select className="input" style={{ width: "auto" }} value={plang} onChange={(e) => setPlang(e.target.value)} aria-label={T(L("Language", "Язык", "Мова", "اللغة"))}><option value="en">English</option><option value="ru">Русский</option><option value="uk">Українська</option><option value="ar">العربية</option></select>
      <select className="input" style={{ width: "auto" }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={T(L("Valid for", "Срок действия", "Строк дії", "مدة الصلاحية"))}>{[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} {T(L("days", "дн.", "дн.", "يوماً"))}</option>)}</select>
      <button className="btn primary sm" disabled={busy} onClick={create}><Icon n="plus" />{busy ? "…" : T(L("Create a link", "Создать ссылку", "Створити посилання", "إنشاء رابط"))}</button>
    </div>
    {url && <div className="gate-msg" style={{ display: "grid", gap: 6 }}><b>{T(L("Copy it now — it is shown only once:", "Скопируйте сейчас — она показывается один раз:", "Скопіюйте зараз — воно показується один раз:", "انسخه الآن — يُعرض مرة واحدة:"))}</b>
      <code style={{ overflowWrap: "anywhere" }}>{url}</code>
      <div className="toolbar"><button className="btn sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast(T(L("Copied", "Скопировано", "Скопійовано", "تم النسخ")))).catch(() => {})}><Icon n="copy" />{T(L("Copy", "Копировать", "Копіювати", "نسخ"))}</button></div></div>}
    {active.length > 0 && <div className="feed">{active.map((x) => <div key={x.id} className="feed-row"><span style={{ flex: 1, minWidth: 0 }}>
      <b>{x.lang.toUpperCase()} · {T(L("until", "до", "до", "حتى"))} {x.expires_at.slice(0, 10)}</b>
      <small className="faint" style={{ display: "block" }}>{who(x.created_by)} · {x.created_at.slice(0, 10)} · {x.last_seen ? `${T(L("opened", "открыта", "відкрито", "فُتح"))} ${x.last_seen.slice(0, 16).replace("T", " ")}` : T(L("not opened yet", "ещё не открывали", "ще не відкривали", "لم يُفتح بعد"))}</small></span>
      <button className="btn ghost sm danger" onClick={() => revoke(x.id)}>{T(L("Revoke", "Отозвать", "Відкликати", "إلغاء"))}</button></div>)}</div>}
  </section>;
}
