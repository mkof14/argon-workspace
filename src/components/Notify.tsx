"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/sb";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const key = (b64: string) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const api = (b: any) => fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

/** Notifications on this device: state, turn on, turn off, test. */
export function usePush() {
  const [state, setState] = useState<"unsupported" | "ios" | "blocked" | "off" | "on" | "…">("…");
  const check = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      const ios = /iPhone|iPad/.test(navigator.userAgent) && !(navigator as any).standalone; setState(ios ? "ios" : "unsupported"); return;
    }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  };
  useEffect(() => { check().catch(() => setState("unsupported")); }, []);
  const enable = async () => {
    if (DEMO) throw new Error("demo");
    const perm = await Notification.requestPermission(); if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return false; }
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js")); await navigator.serviceWorker.ready;
    const r = await fetch("/api/push"); if (!r.ok) throw new Error(await r.text()); const { key: k } = await r.json();
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(k) }));
    const s = await api({ action: "subscribe", sub: sub.toJSON() }); if (!s.ok) throw new Error(await s.text());
    setState("on"); await api({ action: "test" }); return true;
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api({ action: "unsubscribe", endpoint: sub.endpoint }); await sub.unsubscribe(); }
    setState("off");
  };
  const test = () => api({ action: "test" });
  return { state, enable, disable, test };
}

/** Card for My profile. */
export function NotifyCard() {
  const { lang, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const p = usePush(); const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<any>) => { setBusy(true); try { await f(); } catch (e: any) { toast(e.message === "demo" ? T(L("Works on the live site.", "Работает на рабочем сайте.", "Працює на робочому сайті.", "يعمل على الموقع الفعلي.")) : e.message || "Error", true); } finally { setBusy(false); } };
  const note: Record<string, T4> = {
    on: L("On for this device. You get approvals, @mentions and agent news.", "Включены на этом устройстве. Приходят согласования, @упоминания и новости агентов.", "Увімкнено на цьому пристрої. Надходять погодження, @згадки та новини агентів.", "مفعّلة على هذا الجهاز. تصلك الموافقات والإشارات وأخبار الوكلاء."),
    off: L("Get a short signal on this phone or computer when your decision is needed or someone mentions you.", "Короткий сигнал на этот телефон или компьютер, когда нужно ваше решение или вас упомянули.", "Короткий сигнал на цей телефон або комп'ютер, коли потрібне ваше рішення або вас згадали.", "إشارة قصيرة على هذا الهاتف أو الحاسوب عندما يلزم قرارك أو يشير إليك أحد."),
    blocked: L("Notifications are blocked in this browser. Allow them in the site settings (lock icon next to the address), then try again.", "Уведомления запрещены в этом браузере. Разрешите их в настройках сайта (значок замка у адреса), затем попробуйте снова.", "Сповіщення заборонено в цьому браузері. Дозвольте їх у налаштуваннях сайту (значок замка біля адреси), потім спробуйте знову.", "الإشعارات محظورة في هذا المتصفح. اسمح بها من إعدادات الموقع (رمز القفل بجانب العنوان) ثم أعد المحاولة."),
    ios: L("On iPhone and iPad: first install Workspace (Share → Add to Home Screen), open it from the icon, then turn notifications on here.", "На iPhone и iPad: сначала установите Workspace («Поделиться» → «На экран Домой»), откройте его с иконки, затем включите уведомления здесь.", "На iPhone та iPad: спершу встановіть Workspace («Поділитися» → «На початковий екран»), відкрийте його з іконки, потім увімкніть сповіщення тут.", "على iPhone وiPad: ثبّت مساحة العمل أولاً (مشاركة ← إضافة إلى الشاشة الرئيسية)، وافتحها من الأيقونة، ثم فعّل الإشعارات هنا."),
    unsupported: L("This browser cannot show notifications.", "Этот браузер не умеет показывать уведомления.", "Цей браузер не вміє показувати сповіщення.", "هذا المتصفح لا يدعم الإشعارات."),
    "…": L("…", "…", "…", "…"),
  };
  return <section className="card">
    <div className="card-h toolbar"><h2><Icon n="bell" />{T(L("Notifications on this device", "Уведомления на этом устройстве", "Сповіщення на цьому пристрої", "الإشعارات على هذا الجهاز"))}</h2>
      {p.state === "on" ? <span className="chip c-ok" style={{ marginInlineStart: "auto" }}>{T(L("On", "Включены", "Увімкнено", "مفعّلة"))}</span> : null}</div>
    <div className="card-b" style={{ display: "grid", gap: 10 }}>
      <p className="faint" style={{ margin: 0 }}>{T(note[p.state])}</p>
      <div className="toolbar">
        {p.state === "off" && <button className="btn primary" disabled={busy} onClick={() => run(p.enable)}><Icon n="bell" />{T(L("Turn on", "Включить", "Увімкнути", "تفعيل"))}</button>}
        {p.state === "on" && <><button className="btn" disabled={busy} onClick={() => run(p.test)}><Icon n="send" />{T(L("Send a test", "Проверить", "Перевірити", "إرسال تجربة"))}</button>
          <button className="btn ghost" disabled={busy} onClick={() => run(p.disable)}>{T(L("Turn off", "Выключить", "Вимкнути", "إيقاف"))}</button></>}
      </div>
    </div>
  </section>;
}

/** One-line invitation in My day until notifications are on (can be hidden). */
export function NotifyHint() {
  const { lang, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const p = usePush(); const [hide, setHide] = useState(true);
  useEffect(() => { try { setHide(localStorage.getItem("agronws.pushhint") === "no"); } catch { setHide(false); } }, []);
  if (hide || p.state !== "off" || DEMO) return null;
  return <div className="card notify-hint"><div className="card-b toolbar" style={{ gap: 10 }}>
    <Icon n="bell" /><span style={{ flex: 1, minWidth: 200 }}>{T(L("Turn on notifications to see approvals and mentions on your phone right away.", "Включите уведомления, чтобы сразу видеть согласования и упоминания на телефоне.", "Увімкніть сповіщення, щоб одразу бачити погодження та згадки на телефоні.", "فعّل الإشعارات لترى الموافقات والإشارات على هاتفك فوراً."))}</span>
    <button className="btn primary sm" onClick={() => p.enable().catch((e) => toast(e.message, true))}>{T(L("Turn on", "Включить", "Увімкнути", "تفعيل"))}</button>
    <button className="btn ghost sm" onClick={() => { setHide(true); try { localStorage.setItem("agronws.pushhint", "no"); } catch {} }}>{T(L("Not now", "Не сейчас", "Не зараз", "ليس الآن"))}</button>
  </div></div>;
}
