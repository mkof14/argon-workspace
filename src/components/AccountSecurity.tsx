"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type P = { id: string; email: string; full_name: string; role: string; disabled: boolean; sessions_revoked_at: string | null; mfa: boolean; privileged: boolean };
type S = { mfa_required: boolean; me_aal: string; people: P[] };
const api = async (b: any) => { const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };

/** Administration → Users → Sign-in security: two-step sign-in for owners/administrators, ending sessions, switching accounts off. */
export default function AccountSecurity() {
  const { lang, me, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [s, setS] = useState<S | null>(null); const [busy, setBusy] = useState("");
  const load = () => { if (!DEMO) api({ action: "security" }).then(setS).catch((e) => toast(e.message, true)); };
  useEffect(load, []); // eslint-disable-line
  const act = async (key: string, b: any, ok: T4, confirmText?: T4) => {
    if (confirmText && !window.confirm(T(confirmText))) return;
    setBusy(key); try { await api(b); toast(T(ok)); load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };
  if (DEMO) return null;
  const privNoMfa = s?.people.filter((p) => p.privileged && !p.mfa && !p.disabled) || [];
  return <section className="card">
    <div className="card-h"><h2><Icon n="lock" />{T(L("Sign-in security", "Безопасность входа", "Безпека входу", "أمان تسجيل الدخول"))}</h2></div>
    <div className="card-b" style={{ display: "grid", gap: 14 }}>
      {s && <div className="bk-box">
        <div className="toolbar"><b>{T(L("Two-step sign-in for owners and administrators", "Двухэтапный вход для владельцев и администраторов", "Двоетапний вхід для власників і адміністраторів", "التحقق بخطوتين للمالكين والمسؤولين"))}</b>
          <span className={`chip ${s.mfa_required ? "c-ok" : "c-warn"}`} style={{ marginInlineStart: "auto" }}>{s.mfa_required ? T(L("Required", "Обязателен", "Обов'язковий", "إلزامي")) : T(L("Not required yet", "Пока не обязателен", "Поки не обов'язковий", "غير إلزامي بعد"))}</span></div>
        <p className="faint" style={{ margin: 0 }}>{T(L("When required, an owner or administrator without the code from their phone app sees nothing and can change nothing — in the interface, through the API and directly in the database.", "Когда это обязательно, владелец или администратор без кода из приложения на телефоне ничего не видит и не может изменить — ни в интерфейсе, ни через API, ни напрямую в базе.", "Коли це обов'язково, власник або адміністратор без коду із застосунку на телефоні нічого не бачить і не може змінити — ні в інтерфейсі, ні через API, ні напряму в базі.", "عند الإلزام لا يرى المالك أو المسؤول بلا رمز الهاتف شيئاً ولا يغيّر شيئاً — في الواجهة أو عبر API أو في قاعدة البيانات."))}</p>
        {privNoMfa.length > 0 && <small style={{ color: "var(--warn)" }}>{T(L("Not set up yet", "Ещё не настроили", "Ще не налаштували", "لم يُعدّ بعد"))}: {privNoMfa.map((p) => p.full_name || p.email).join(", ")} — {T(L("they will be asked to set it up at their next sign-in.", "им будет предложено настроить при следующем входе.", "їм буде запропоновано налаштувати під час наступного входу.", "سيُطلب منهم الإعداد عند الدخول التالي."))}</small>}
        {me.role === "owner" && <div className="toolbar">
          {s.mfa_required ? <button className="btn sm" disabled={!!busy} onClick={() => act("mfa", { action: "mfa_required", on: false }, L("Switched off", "Выключено", "Вимкнено", "أُوقف"))}>{T(L("Stop requiring it", "Больше не требовать", "Більше не вимагати", "إلغاء الإلزام"))}</button>
            : <button className="btn primary sm" disabled={!!busy} onClick={() => act("mfa", { action: "mfa_required", on: true }, L("Two-step sign-in is now required", "Двухэтапный вход теперь обязателен", "Двоетапний вхід тепер обов'язковий", "أصبح التحقق بخطوتين إلزامياً"))}><Icon n="lock" />{T(L("Require it", "Сделать обязательным", "Зробити обов'язковим", "اجعله إلزامياً"))}</button>}
          {!s.mfa_required && s.me_aal !== "aal2" && <small className="faint">{T(L("First set up your own authenticator (My profile → Sign-in protection) and sign in again with the code.", "Сначала настройте свой аутентификатор («Мой профиль → Защита входа») и войдите снова с кодом.", "Спершу налаштуйте свій автентифікатор («Мій профіль → Захист входу») і ввійдіть знову з кодом.", "أعدّ أولاً تطبيق المصادقة الخاص بك ثم سجّل الدخول مجدداً بالرمز."))}</small>}
        </div>}
      </div>}
      {s ? <div className="tablewrap"><table className="tb"><thead><tr>
        <th>{T(L("Person", "Человек", "Людина", "الشخص"))}</th><th>{T(L("Two-step", "Двухэтапный", "Двоетапний", "خطوتان"))}</th><th>{T(L("Account", "Учётная запись", "Обліковий запис", "الحساب"))}</th><th /></tr></thead>
        <tbody>{s.people.map((p) => <tr key={p.id}>
          <td><b>{p.full_name || p.email}</b><br /><small className="faint">{p.email} · {p.role}</small></td>
          <td>{p.mfa ? <span className="chip c-ok">{T(L("On", "Вкл.", "Увімк.", "مفعّل"))}</span> : <span className={`chip ${p.privileged ? "c-warn" : ""}`}>{T(L("Off", "Выкл.", "Вимк.", "متوقف"))}</span>}</td>
          <td>{p.disabled ? <span className="chip c-bad">{T(L("Switched off", "Отключена", "Вимкнено", "متوقف"))}</span> : <span className="chip c-ok">{T(L("Active", "Активна", "Активний", "نشط"))}</span>}
            {p.sessions_revoked_at && <><br /><small className="faint">{T(L("Sessions ended", "Сеансы завершены", "Сеанси завершено", "أُنهيت الجلسات"))} {p.sessions_revoked_at.slice(0, 16).replace("T", " ")}</small></>}</td>
          <td><div className="toolbar" style={{ justifyContent: "flex-end", gap: 6 }}>
            {p.id !== me.id && <button className="btn ghost sm" disabled={!!busy} onClick={() => act(`r${p.id}`, { action: "revoke", user: p.id }, L("Sessions ended", "Сеансы завершены", "Сеанси завершено", "أُنهيت الجلسات"), L("End every session of this person now? They must sign in again.", "Завершить все сеансы этого человека сейчас? Ему нужно будет войти снова.", "Завершити всі сеанси цієї людини зараз? Їй треба буде ввійти знову.", "إنهاء كل جلسات هذا الشخص الآن؟"))}>{T(L("End sessions", "Завершить сеансы", "Завершити сеанси", "إنهاء الجلسات"))}</button>}
            {p.mfa && p.id !== me.id && <button className="btn ghost sm" disabled={!!busy} onClick={() => act(`m${p.id}`, { action: "reset_mfa", user: p.id }, L("Authenticator reset", "Аутентификатор сброшен", "Автентифікатор скинуто", "أُعيد ضبط المصادقة"), L("Remove this person's authenticator (for a lost phone)? They set it up again at the next sign-in.", "Удалить аутентификатор этого человека (если потерян телефон)? Он настроит его снова при следующем входе.", "Видалити автентифікатор цієї людини (якщо втрачено телефон)? Вона налаштує його знову під час наступного входу.", "إزالة تطبيق المصادقة لهذا الشخص؟"))}>{T(L("Reset authenticator", "Сбросить аутентификатор", "Скинути автентифікатор", "إعادة ضبط المصادقة"))}</button>}
            {p.id !== me.id && <button className={`btn sm ${p.disabled ? "" : "ghost"}`} disabled={!!busy} onClick={() => act(`d${p.id}`, { action: "disable", user: p.id, on: !p.disabled }, p.disabled ? L("Switched on", "Включена", "Увімкнено", "شُغّل") : L("Switched off", "Отключена", "Вимкнено", "أُوقف"), p.disabled ? undefined : L("Switch this account off? The person loses access at once; their records stay.", "Отключить эту учётную запись? Человек сразу теряет доступ; его записи остаются.", "Вимкнути цей обліковий запис? Людина одразу втрачає доступ; її записи лишаються.", "إيقاف هذا الحساب؟ يفقد الشخص الوصول فوراً."))}>{p.disabled ? T(L("Switch on", "Включить", "Увімкнути", "تشغيل")) : T(L("Switch off", "Отключить", "Вимкнути", "إيقاف"))}</button>}
          </div></td></tr>)}</tbody></table></div> : <div className="faint">…</div>}
    </div>
  </section>;
}
