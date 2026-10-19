"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, store } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });

/** Connection bar: without a connection changes wait on the device; when it is back they are sent by themselves. */
export default function OfflineBar() {
  const { lang, toast, reload } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [on, setOn] = useState(true); const [n, setN] = useState(0); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState<{ id: string; error?: string; kind: string; conflict?: { fields: string[] }; rec?: any }[]>([]);
  const count = async () => { setN(await store.outboxCount()); setFailed(await store.outboxFailed() as any); };
  const flush = async () => {
    if (busy || !navigator.onLine) return; setBusy(true);
    try { const sent = await store.flushOutbox(); await count(); if (sent) { toast(`${T(L("Sent after reconnecting", "Отправлено после восстановления связи", "Надіслано після відновлення зв'язку", "أُرسل بعد عودة الاتصال"))}: ${sent}`); reload(); } } finally { setBusy(false); }
  };
  useEffect(() => {
    if (DEMO) return;
    setOn(navigator.onLine); count().then(() => flush());
    const up = () => { setOn(true); flush(); }, down = () => setOn(false), ch = () => count();
    window.addEventListener("online", up); window.addEventListener("offline", down); window.addEventListener("agron-outbox", ch);
    const t = setInterval(() => { if (navigator.onLine) store.outboxCount().then((k) => { setN(k); if (k) flush(); }); }, 30000);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); window.removeEventListener("agron-outbox", ch); clearInterval(t); };
  }, []); // eslint-disable-line
  if (DEMO || (on && !n && !failed.length)) return null;
  return <div className={`offbar ${on ? "" : "off"}`} role="status">
    <Icon n={on ? "refresh" : "alert"} />
    <span>{!on ? T(L("No connection — your changes are kept on this device and will be sent by themselves.", "Нет связи — ваши изменения сохраняются на этом устройстве и отправятся сами.", "Немає зв'язку — ваші зміни зберігаються на цьому пристрої й надішлються самі.", "لا اتصال — تُحفظ تغييراتك على هذا الجهاز وتُرسل تلقائياً.")) : busy ? T(L("Sending saved changes…", "Отправляю сохранённые изменения…", "Надсилаю збережені зміни…", "أرسل التغييرات المحفوظة…")) : T(L("Changes waiting to be sent", "Изменения ждут отправки", "Зміни чекають надсилання", "تغييرات بانتظار الإرسال"))}{n ? ` · ${n}` : ""}</span>
    {on && n > 0 && !busy && <button className="btn sm" onClick={flush}>{T(L("Send now", "Отправить сейчас", "Надіслати зараз", "أرسل الآن"))}</button>}
    {failed.map((f) => <span key={f.id} className="offbar-err">{f.conflict
      ? <>{T(L("Changed by someone else while you were offline", "Пока вы были без связи, это изменил кто-то другой", "Поки ви були без зв'язку, це змінив хтось інший", "غيّره شخص آخر أثناء انقطاعك"))}: <b>{f.rec?.title}</b> ({f.conflict.fields.map((x) => x.replace(/^data\./, "")).join(", ")}) <button className="linkbtn" onClick={async () => { await store.keepMine(f.id); await count(); flush(); }}>{T(L("Keep mine", "Оставить моё", "Залишити моє", "احتفظ بنسختي"))}</button> · <button className="linkbtn" onClick={async () => { await store.dropOutboxItem(f.id); count(); reload(); }}>{T(L("Keep theirs", "Оставить их версию", "Залишити їхню", "احتفظ بنسختهم"))}</button></>
      : <>{T(L("Not sent", "Не отправлено", "Не надіслано", "لم يُرسل"))}: {f.error} <button className="linkbtn" onClick={async () => { await store.dropOutboxItem(f.id); count(); }}>{T(L("Discard", "Удалить", "Видалити", "تجاهل"))}</button></>}</span>)}
  </div>;
}
