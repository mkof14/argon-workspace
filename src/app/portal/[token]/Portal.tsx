"use client";
import { useEffect, useState } from "react";

type Lg = "en" | "ru" | "uk" | "ar";
const W: Record<string, Record<Lg, string>> = {
  hello: { en: "Client portal", ru: "Портал клиента", uk: "Портал клієнта", ar: "بوابة العميل" },
  sub: { en: "Your orders, documents and service with AGRON — always up to date.", ru: "Ваши заказы, документы и сервис AGRON — всегда актуально.", uk: "Ваші замовлення, документи та сервіс AGRON — завжди актуально.", ar: "طلباتك ومستنداتك وخدمتك مع AGRON — محدثة دائماً." },
  orders: { en: "Orders", ru: "Заказы", uk: "Замовлення", ar: "الطلبات" }, noOrders: { en: "No orders in progress.", ru: "Заказов в работе нет.", uk: "Замовлень у роботі немає.", ar: "لا طلبات قيد التنفيذ." },
  ship: { en: "Shipping", ru: "Доставка", uk: "Доставка", ar: "الشحن" }, eta: { en: "expected", ru: "ожидается", uk: "очікується", ar: "متوقع" }, track: { en: "Track", ru: "Отследить", uk: "Відстежити", ar: "تتبع" },
  inst: { en: "Installation", ru: "Установка", uk: "Встановлення", ar: "التركيب" },
  props: { en: "Proposals", ru: "Коммерческие предложения", uk: "Комерційні пропозиції", ar: "العروض" }, valid: { en: "valid until", ru: "действует до", uk: "діє до", ar: "صالح حتى" }, pdf: { en: "Download PDF", ru: "Скачать PDF", uk: "Завантажити PDF", ar: "تنزيل PDF" },
  inv: { en: "Invoices", ru: "Счета", uk: "Рахунки", ar: "الفواتير" }, due: { en: "due", ru: "срок", uk: "строк", ar: "الاستحقاق" },
  units: { en: "Installed systems", ru: "Установленные системы", uk: "Встановлені системи", ar: "الأنظمة المركّبة" }, warranty: { en: "Warranty until", ru: "Гарантия до", uk: "Гарантія до", ar: "الضمان حتى" }, service: { en: "Next service", ru: "Следующий сервис", uk: "Наступний сервіс", ar: "الصيانة القادمة" },
  req: { en: "Service requests", ru: "Заявки в сервис", uk: "Заявки в сервіс", ar: "طلبات الصيانة" }, newReq: { en: "New request", ru: "Новая заявка", uk: "Нова заявка", ar: "طلب جديد" },
  what: { en: "What happened?", ru: "Что случилось?", uk: "Що сталося?", ar: "ماذا حدث؟" }, details: { en: "Details (what you see, since when, location)", ru: "Подробности (что видите, с какого момента, где)", uk: "Подробиці (що бачите, з якого моменту, де)", ar: "التفاصيل (ما تراه ومنذ متى وأين)" },
  urgency: { en: "Urgency", ru: "Срочность", uk: "Терміновість", ar: "الأولوية" }, contact: { en: "How to reach you (phone or e-mail)", ru: "Как с вами связаться (телефон или почта)", uk: "Як з вами зв'язатися (телефон або пошта)", ar: "كيف نتواصل معك (هاتف أو بريد)" },
  unit: { en: "System", ru: "Система", uk: "Система", ar: "النظام" }, send: { en: "Send request", ru: "Отправить заявку", uk: "Надіслати заявку", ar: "إرسال الطلب" },
  sent: { en: "Thank you — our service team has your request and will contact you.", ru: "Спасибо — заявка у нашей сервисной команды, мы свяжемся с вами.", uk: "Дякуємо — заявка в нашої сервісної команди, ми зв'яжемося з вами.", ar: "شكراً — وصل طلبك إلى فريق الصيانة وسنتواصل معك." },
  limit: { en: "Too many requests today — please call or write to info@agron1.com.", ru: "Слишком много заявок за сегодня — позвоните или напишите на info@agron1.com.", uk: "Забагато заявок за сьогодні — зателефонуйте або напишіть на info@agron1.com.", ar: "طلبات كثيرة اليوم — يرجى الاتصال أو الكتابة إلى info@agron1.com." },
  gone: { en: "This link is not valid any more. Please ask your AGRON contact for a new one.", ru: "Эта ссылка больше не действует. Попросите у вашего контакта в AGRON новую.", uk: "Це посилання більше не дійсне. Попросіть у вашого контакту в AGRON нове.", ar: "هذا الرابط لم يعد صالحاً. اطلب رابطاً جديداً من جهة اتصالك في AGRON." },
  until: { en: "This personal link works until", ru: "Эта личная ссылка действует до", uk: "Це особисте посилання діє до", ar: "يعمل هذا الرابط الشخصي حتى" },
  privacy: { en: "Do not forward it: anyone with the link sees this page.", ru: "Не пересылайте её: эту страницу видит любой, у кого есть ссылка.", uk: "Не пересилайте його: цю сторінку бачить кожен, хто має посилання.", ar: "لا تعِد توجيهه: يرى هذه الصفحة كل من لديه الرابط." },
  none: { en: "Nothing here yet.", ru: "Пока пусто.", uk: "Поки порожньо.", ar: "لا شيء بعد." },
};
const STEPS: Record<Lg, string[]> = {
  en: ["Design", "Procurement", "Assembly", "Integration", "Testing", "Shipping", "Installed"],
  ru: ["Проект", "Закупки", "Сборка", "Интеграция", "Испытания", "Отгрузка", "Установлено"],
  uk: ["Проєкт", "Закупівлі", "Збирання", "Інтеграція", "Випробування", "Відвантаження", "Встановлено"],
  ar: ["التصميم", "المشتريات", "التجميع", "التكامل", "الاختبار", "الشحن", "مُركّب"],
};
const ST: Record<string, [string, string, string]> = { Planned: ["Запланировано", "Заплановано", "مخطط"], "Docs in prep": ["Готовим документы", "Готуємо документи", "تجهيز المستندات"], "In transit": ["В пути", "У дорозі", "في الطريق"], Customs: ["Таможня", "Митниця", "الجمارك"], Delivered: ["Доставлено", "Доставлено", "تم التسليم"],
  Approvals: ["Разрешения", "Дозволи", "الموافقات"], "On site": ["На объекте", "На об'єкті", "في الموقع"], Commissioned: ["Введено в работу", "Введено в роботу", "تم التشغيل"], Sent: ["Выставлен", "Виставлено", "مُرسلة"], Due: ["К оплате", "До сплати", "مستحقة"],
  Overdue: ["Просрочен", "Прострочено", "متأخرة"], Paid: ["Оплачен", "Сплачено", "مدفوعة"], New: ["Новая", "Нова", "جديد"], "In progress": ["В работе", "У роботі", "قيد العمل"], "Waiting client": ["Ждём вас", "Чекаємо на вас", "بانتظارك"], Resolved: ["Решено", "Вирішено", "تم الحل"],
  Accepted: ["Принято", "Прийнято", "مقبول"], Active: ["Работает", "Працює", "يعمل"], "Maintenance due": ["Нужен сервис", "Потрібен сервіс", "تحتاج صيانة"] };
const SEV: Record<Lg, Record<string, string>> = { en: { Low: "Low", Medium: "Normal", High: "High", Critical: "System down" }, ru: { Low: "Низкая", Medium: "Обычная", High: "Высокая", Critical: "Система не работает" }, uk: { Low: "Низька", Medium: "Звичайна", High: "Висока", Critical: "Система не працює" }, ar: { Low: "منخفضة", Medium: "عادية", High: "عالية", Critical: "النظام متوقف" } };
const TRACK: Record<string, (n: string) => string> = { Maersk: (n) => `https://www.maersk.com/tracking/${n}`, "Hapag-Lloyd": (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${n}`, MSC: (n) => `https://www.msc.com/en/track-a-shipment?trackingNumber=${n}`, DHL: (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${n}`, FedEx: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` };
const post = (b: any) => fetch("/api/portal/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

export default function Portal({ token }: { token: string }) {
  const [v, setV] = useState<any>(null); const [err, setErr] = useState(false);
  const [lang, setLang] = useState<Lg>("en");
  const [form, setForm] = useState({ title: "", severity: "Medium", notes: "", contact: "", unit_id: "" }); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => post({ token }).then(async (r) => { if (!r.ok) { setErr(true); return; } const j = await r.json(); setV(j); setLang((l) => { try { const s = localStorage.getItem("agron.portal.lang") as Lg; if (s) return s; } catch {} const nav = navigator.language.slice(0, 2); return (["ru", "uk", "ar"].includes(nav) ? nav : j.lang || "en") as Lg; }); }).catch(() => setErr(true));
  useEffect(() => { try { const s = localStorage.getItem("agron.portal.lang") as Lg; const nav = navigator.language.slice(0, 2) as Lg; setLang(s || (["ru", "uk", "ar"].includes(nav) ? nav : "en")); } catch {} load(); }, []); // eslint-disable-line
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; try { localStorage.setItem("agron.portal.lang", lang); } catch {} }, [lang]);
  const w = (k: string) => W[k][lang];
  const st = (x: string) => (lang === "en" || !ST[x] ? x : ST[x][lang === "ru" ? 0 : lang === "uk" ? 1 : 2]);
  const d = (s: string | null) => (s ? new Date(s.slice(0, 10) + "T00:00:00Z").toLocaleDateString(lang === "en" ? "en-US" : lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
  const m = (n: number, c: string) => `${n.toLocaleString(lang === "en" ? "en-US" : lang, { maximumFractionDigits: 2 })} ${c}`;
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (form.title.trim().length < 3) return; setBusy(true);
    const r = await post({ token, request: form }).then((x) => x.json()).catch(() => ({ ok: false }));
    setBusy(false); setMsg(r.ok ? w("sent") : r.reason === "limit" ? w("limit") : w("gone"));
    if (r.ok) { setForm({ title: "", severity: "Medium", notes: "", contact: form.contact, unit_id: "" }); load(); }
  };
  const Head = <header className="pt-head"><div className="pt-logo"><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} /></div>
    <select className="input pt-lang" value={lang} onChange={(e) => setLang(e.target.value as Lg)} aria-label="Language"><option value="en">English</option><option value="ru">Русский</option><option value="uk">Українська</option><option value="ar">العربية</option></select></header>;
  if (err) return <main className="pt">{Head}<section className="card"><div className="card-b">{w("gone")}</div></section></main>;
  if (!v) return <main className="pt">{Head}<div className="empty">…</div></main>;
  return <main className="pt">
    {Head}
    <section className="pt-hero"><small>{w("hello")}</small><h1>{v.client.name}</h1><p>{w("sub")}</p></section>

    <section className="card"><div className="card-h"><h2>{w("orders")}</h2></div><div className="card-b pt-list">
      {!v.orders.length ? <p className="faint">{w("noOrders")}</p> : v.orders.map((o: any) => <div key={o.id} className="pt-order">
        <b>{o.title}</b>{o.config && <span className="chip">StarDome {o.config}</span>}
        <ol className="pt-steps" aria-label={w("orders")}>{STEPS[lang].map((s, i) => <li key={i} className={i < o.step ? "done" : i === o.step ? "now" : ""}><span>{s}</span></li>)}</ol>
        {o.shipping && <div className="pt-row"><b>{w("ship")}:</b> {st(o.shipping.status)}{o.shipping.eta ? ` · ${w("eta")} ${d(o.shipping.eta)}` : ""}{o.shipping.carrier ? ` · ${o.shipping.carrier}` : ""}
          {o.shipping.tracking && TRACK[o.shipping.carrier] && <> · <a href={TRACK[o.shipping.carrier](o.shipping.tracking)} target="_blank" rel="noopener noreferrer">{w("track")} {o.shipping.tracking}</a></>}</div>}
        {o.installation && <div className="pt-row"><b>{w("inst")}:</b> {st(o.installation.status)}{o.installation.date ? ` · ${d(o.installation.date)}` : ""}{o.installation.site ? ` · ${o.installation.site}` : ""}</div>}
      </div>)}</div></section>

    {v.proposals.length > 0 && <section className="card"><div className="card-h"><h2>{w("props")}</h2></div><div className="feed">{v.proposals.map((p: any) => <div key={p.id} className="feed-row">
      <span style={{ flex: 1, minWidth: 0 }}><b>{p.number}</b> · StarDome {p.config}<small className="faint" style={{ display: "block" }}>{m(p.value, p.currency)}{p.valid_until ? ` · ${w("valid")} ${d(p.valid_until)}` : ""}</small></span>
      {p.pdf && <a className="btn sm" href={p.pdf}>{w("pdf")}</a>}</div>)}</div></section>}

    {v.invoices.length > 0 && <section className="card"><div className="card-h"><h2>{w("inv")}</h2></div><div className="feed">{v.invoices.map((i: any) => <div key={i.id} className="feed-row">
      <span style={{ flex: 1, minWidth: 0 }}><b>{i.title}</b><small className="faint" style={{ display: "block" }}>{w("due")} {d(i.due)}</small></span>
      <span className="mono">{m(i.amount, i.currency)}</span><span className={`chip ${i.status === "Paid" ? "c-ok" : i.status === "Overdue" ? "c-bad" : ""}`}>{st(i.status)}</span></div>)}</div></section>}

    {v.units.length > 0 && <section className="card"><div className="card-h"><h2>{w("units")}</h2></div><div className="feed">{v.units.map((u: any) => <div key={u.id} className="feed-row">
      <span style={{ flex: 1, minWidth: 0 }}><b>{u.title}</b><small className="faint" style={{ display: "block" }}>{[u.config && `StarDome ${u.config}`, u.serial, u.site].filter(Boolean).join(" · ")}</small></span>
      <small>{w("warranty")} {d(u.warranty_end)}<br />{w("service")} {d(u.next_service)}</small></div>)}</div></section>}

    <section className="card"><div className="card-h"><h2>{w("req")}</h2></div>
      {v.requests.length > 0 && <div className="feed">{v.requests.map((r: any) => <div key={r.id} className="feed-row"><span style={{ flex: 1 }}><b>{r.title}</b><small className="faint" style={{ display: "block" }}>{SEV[lang][r.severity] || r.severity} · {d(r.updated)}</small></span><span className="chip">{st(r.status)}</span></div>)}</div>}
      <form className="card-b pt-form" onSubmit={send}><h3>{w("newReq")}</h3>
        <label>{w("what")}<input className="input" required minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        {v.units.length > 0 && <label>{w("unit")}<select className="input" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}><option value="">—</option>{v.units.map((u: any) => <option key={u.id} value={u.id}>{u.title}</option>)}</select></label>}
        <label>{w("urgency")}<select className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{["Low", "Medium", "High", "Critical"].map((s) => <option key={s} value={s}>{SEV[lang][s]}</option>)}</select></label>
        <label>{w("details")}<textarea className="input" rows={4} maxLength={4000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <label>{w("contact")}<input className="input" maxLength={200} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
        <div><button className="btn primary" disabled={busy}>{busy ? "…" : w("send")}</button></div>
        {msg && <p role="status" className="pt-msg">{msg}</p>}
      </form></section>

    <footer className="pt-foot">{w("until")} {d(v.expires)}. {w("privacy")}<br />AGRON Inc. · <a href="mailto:info@agron1.com">info@agron1.com</a> · agron1.com</footer>
  </main>;
}
