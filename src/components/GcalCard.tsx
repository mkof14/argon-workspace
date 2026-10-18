"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/sb";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

/** My profile: two-way sync with the person's Google Calendar. */
export default function GcalCard() {
  const { lang, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [s, setS] = useState<{ configured: boolean; link: any } | null>(null); const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/gcal").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  useEffect(() => {
    if (DEMO) { setS({ configured: false, link: null }); return; }
    load();
    const q = new URLSearchParams(location.search).get("gcal");
    if (q) { toast(q === "ok" ? T(L("Google Calendar connected", "Google Calendar подключён", "Google Calendar підключено", "تم ربط تقويم Google")) : q === "declined" ? T(L("Connection cancelled", "Подключение отменено", "Підключення скасовано", "أُلغي الربط")) : decodeURIComponent(q), q !== "ok"); history.replaceState(null, "", location.pathname); }
  }, []); // eslint-disable-line
  const post = async (action: string) => { setBusy(true); try { const r = await fetch("/api/gcal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); const j = await r.json().catch(() => ({})); if (action === "sync") toast(j.ok ? `${T(L("Synced", "Синхронизировано", "Синхронізовано", "تمت المزامنة"))}: ↑${j.pushed} ↓${j.pulled}` : j.reason || "Error", !j.ok); await load(); } finally { setBusy(false); } };
  if (!s) return null;
  return <section className="card">
    <div className="card-h toolbar"><h2><Icon n="calendar" />Google Calendar</h2>{s.link && <span className="chip c-ok" style={{ marginInlineStart: "auto" }}>{s.link.google_email || T(L("Connected", "Подключён", "Підключено", "مربوط"))}</span>}</div>
    <div className="card-b" style={{ display: "grid", gap: 10 }}>
      <p className="faint" style={{ margin: 0 }}>{T(L("Two-way: your planned client meetings and company meetings appear in your Google Calendar; meetings in Google with a client's people appear in Meetings & calls, linked to the client's open deal. Sync runs on its own; the button runs it now.",
        "В обе стороны: ваши запланированные встречи с клиентами и встречи компании появляются в Google Calendar; встречи в Google с людьми клиента появляются во «Встречах и звонках» и привязываются к открытой сделке клиента. Синхронизация идёт сама; кнопка запускает её сейчас.",
        "В обидва боки: ваші заплановані зустрічі з клієнтами й зустрічі компанії з'являються в Google Calendar; зустрічі в Google з людьми клієнта з'являються в «Зустрічах і дзвінках» і прив'язуються до відкритої угоди клієнта. Синхронізація йде сама; кнопка запускає її зараз.",
        "في الاتجاهين: تظهر اجتماعاتك المخططة مع العملاء واجتماعات الشركة في تقويم Google؛ وتظهر اجتماعات Google مع أشخاص العميل في «الاجتماعات والمكالمات» مرتبطة بصفقة العميل المفتوحة. تعمل المزامنة تلقائياً؛ والزر يشغّلها الآن."))}</p>
      {!s.configured ? <p className="hint" style={{ margin: 0 }}>{T(L("Not available yet: the owner adds the Google keys in the final setup.", "Пока недоступно: владелец добавит ключи Google при финальной настройке.", "Поки недоступно: власник додасть ключі Google під час фінального налаштування.", "غير متاح بعد: سيضيف المالك مفاتيح Google في الإعداد النهائي."))}</p>
        : !s.link ? <div className="toolbar"><a className="btn primary" href="/api/gcal?start=1"><Icon n="link" />{T(L("Connect Google Calendar", "Подключить Google Calendar", "Підключити Google Calendar", "ربط تقويم Google"))}</a></div>
        : <>{s.link.last_error && <div className="gate-msg">{s.link.last_error}</div>}
          <div className="toolbar"><span className="faint" style={{ fontSize: 13 }}>{T(L("Last sync", "Последняя синхронизация", "Остання синхронізація", "آخر مزامنة"))}: {s.link.last_sync ? s.link.last_sync.slice(0, 16).replace("T", " ") : "—"}</span>
            <button className="btn sm" disabled={busy} onClick={() => post("sync")}><Icon n="refresh" />{busy ? "…" : T(L("Sync now", "Синхронизировать", "Синхронізувати", "مزامنة الآن"))}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => post("disconnect")}>{T(L("Disconnect", "Отключить", "Відключити", "فصل"))}</button></div></>}
    </div>
  </section>;
}
