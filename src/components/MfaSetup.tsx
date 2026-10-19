"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { DEMO, store } from "@/lib/store";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
type Sec = Awaited<ReturnType<typeof store.security>>;

/** Steps shared by the profile card and the sign-in gate: scan the QR code, type the 6-digit code. */
function Enroll({ lang, onDone }: { lang: string; onDone: () => void }) {
  const T = (x: T4) => tx(x, lang as Lang);
  const [f, setF] = useState<{ id: string; qr: string; secret: string } | null>(null); const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { store.mfaEnroll("Authenticator").then(setF).catch((e) => setErr(e.message || "Error")); }, []);
  const ok = async () => { if (!f) return; setBusy(true); setErr(""); try { await store.mfaVerify(f.id, code); onDone(); } catch (e: any) { setErr(T(L("The code did not match. Wait for a new code and try again.", "Код не подошёл. Дождитесь нового кода и попробуйте ещё раз.", "Код не підійшов. Дочекайтеся нового коду й спробуйте ще раз.", "الرمز غير صحيح. انتظر رمزاً جديداً وحاول مجدداً.")) + (e?.message ? ` (${e.message})` : "")); } finally { setBusy(false); } };
  return <div style={{ display: "grid", gap: 12 }}>
    <ol className="cal-steps" style={{ margin: 0 }}>
      <li>{T(L("Install an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or 1Password.", "Установите на телефон приложение-аутентификатор: Google Authenticator, Microsoft Authenticator или 1Password.", "Установіть на телефон застосунок-автентифікатор: Google Authenticator, Microsoft Authenticator або 1Password.", "ثبّت تطبيق مصادقة على هاتفك: Google Authenticator أو Microsoft Authenticator أو 1Password."))}</li>
      <li>{T(L("In the app, add an account and scan this code.", "В приложении добавьте аккаунт и отсканируйте этот код.", "У застосунку додайте обліковий запис і відскануйте цей код.", "في التطبيق أضف حساباً وامسح هذا الرمز."))}</li>
      <li>{T(L("Type the 6-digit code the app shows.", "Введите 6-значный код из приложения.", "Введіть 6-значний код із застосунку.", "اكتب الرمز المكوّن من 6 أرقام الظاهر في التطبيق."))}</li>
    </ol>
    {f ? <div className="mfa-qr"><img src={f.qr} alt={T(L("QR code for the authenticator app", "QR-код для приложения-аутентификатора", "QR-код для застосунку-автентифікатора", "رمز QR لتطبيق المصادقة"))} width={180} height={180} />
      <div><small className="faint">{T(L("Cannot scan? Enter this key in the app:", "Не сканируется? Введите в приложении этот ключ:", "Не сканується? Введіть у застосунку цей ключ:", "لا يمكن المسح؟ أدخل هذا المفتاح في التطبيق:"))}</small><div className="mono" style={{ overflowWrap: "anywhere", fontSize: 13 }}>{f.secret}</div></div></div> : !err && <div className="faint">…</div>}
    <div className="toolbar" style={{ flexWrap: "nowrap" }}>
      <input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} aria-label={T(L("6-digit code", "6-значный код", "6-значний код", "رمز من 6 أرقام"))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && ok()} />
      <button className="btn primary" disabled={busy || code.length !== 6 || !f} onClick={ok}><Icon n="check" />{T(L("Confirm", "Подтвердить", "Підтвердити", "تأكيد"))}</button></div>
    {err && <div className="sys-msg bad" role="alert">{err}</div>}
  </div>;
}

/** My profile → Sign-in protection: set up or remove the authenticator app. */
export default function MfaSetup() {
  const { lang, me, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [s, setS] = useState<Sec | null>(null); const [setup, setSetup] = useState(false);
  const load = () => store.security().then(setS).catch(() => setS(null));
  useEffect(() => { if (!DEMO) load(); }, []);
  const verified = s?.factors.filter((f) => f.status === "verified") || [];
  const priv = ["owner", "admin"].includes(me.role);
  return <section className="card">
    <div className="card-h"><h2><Icon n="lock" />{T(L("Sign-in protection", "Защита входа", "Захист входу", "حماية تسجيل الدخول"))}</h2>
      {s && <span className={`chip ${verified.length ? "c-ok" : priv ? "c-warn" : ""}`} style={{ marginInlineStart: "auto" }}>{verified.length ? T(L("Two-step sign-in is on", "Двухэтапный вход включён", "Двоетапний вхід увімкнено", "التحقق بخطوتين مفعّل")) : T(L("Password only", "Только пароль", "Лише пароль", "كلمة المرور فقط"))}</span>}</div>
    <div className="card-b" style={{ display: "grid", gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>{T(L("After the password, Workspace also asks for a 6-digit code from an app on your phone. Someone who learns your password still cannot sign in.", "После пароля Workspace спрашивает ещё 6-значный код из приложения на телефоне. Даже узнав пароль, посторонний не войдёт.", "Після пароля Workspace запитує ще 6-значний код із застосунку на телефоні. Навіть дізнавшись пароль, сторонній не ввійде.", "بعد كلمة المرور يطلب Workspace رمزاً من 6 أرقام من تطبيق على هاتفك. من يعرف كلمة مرورك لا يستطيع الدخول."))}{priv ? " " + T(L("Owners and administrators must use it once the owner turns the requirement on.", "Владельцы и администраторы обязаны им пользоваться, когда владелец включит это требование.", "Власники й адміністратори мусять ним користуватися, коли власник увімкне цю вимогу.", "على المالكين والمسؤولين استخدامه بعد أن يفعّل المالك هذا الشرط.")) : ""}</p>
      {DEMO ? <div className="faint">{T(L("Works on the live site.", "Работает на живом сайте.", "Працює на живому сайті.", "يعمل على الموقع الحي."))}</div>
        : setup ? <Enroll lang={lang} onDone={() => { setSetup(false); toast(T(L("Two-step sign-in is on", "Двухэтапный вход включён", "Двоетапний вхід увімкнено", "التحقق بخطوتين مفعّل"))); load(); }} />
        : verified.length ? <div className="toolbar">{verified.map((f) => <span key={f.id} className="chip">{f.friendly_name || "Authenticator"}</span>)}
            {!(priv && s?.mfaRequired) && <button className="linkbtn" onClick={async () => { try { for (const f of verified) await store.mfaRemove(f.id); toast(T(L("Removed", "Удалено", "Видалено", "أُزيل"))); load(); } catch (e: any) { toast(e.message || "Error", true); } }}>{T(L("Turn off", "Выключить", "Вимкнути", "إيقاف"))}</button>}</div>
        : <div><button className="btn primary" onClick={() => setSetup(true)}><Icon n="lock" />{T(L("Set up the authenticator app", "Настроить приложение-аутентификатор", "Налаштувати застосунок-автентифікатор", "إعداد تطبيق المصادقة"))}</button></div>}
    </div>
  </section>;
}

/**
 * Shown instead of Workspace when an owner/administrator session still needs its second factor:
 * a code from the app (set up already) or the set-up itself (first time).
 */
export function MfaGate({ sec, lang, onDone, onSignOut }: { sec: Sec; lang: string; onDone: () => void; onSignOut: () => void }) {
  const T = (x: T4) => tx(x, lang as Lang);
  const verified = sec.factors.filter((f) => f.status === "verified");
  const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const ok = async () => { setBusy(true); setErr(""); try { await store.mfaVerify(verified[0].id, code); onDone(); } catch { setErr(T(L("The code did not match. Wait for a new code and try again.", "Код не подошёл. Дождитесь нового кода и попробуйте ещё раз.", "Код не підійшов. Дочекайтеся нового коду й спробуйте ще раз.", "الرمز غير صحيح. انتظر رمزاً جديداً وحاول مجدداً."))); } finally { setBusy(false); } };
  return <div className="login"><div className="box" style={{ maxWidth: 460 }}>
    <div className="brand"><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} /></div>
    <h2 style={{ margin: 0 }}><Icon n="lock" /> {verified.length ? T(L("Confirm it is you", "Подтвердите, что это вы", "Підтвердьте, що це ви", "أكّد هويتك")) : T(L("Turn on two-step sign-in", "Включите двухэтапный вход", "Увімкніть двоетапний вхід", "فعّل التحقق بخطوتين"))}</h2>
    <p className="muted" style={{ margin: 0 }}>{verified.length ? T(L("Type the 6-digit code from your authenticator app.", "Введите 6-значный код из приложения-аутентификатора.", "Введіть 6-значний код із застосунку-автентифікатора.", "اكتب الرمز من تطبيق المصادقة."))
      : T(L("Owners and administrators sign in with a code from a phone app as well as the password. It takes two minutes, once.", "Владельцы и администраторы входят с кодом из приложения на телефоне в дополнение к паролю. Это две минуты, один раз.", "Власники й адміністратори входять із кодом із застосунку на телефоні на додачу до пароля. Це дві хвилини, один раз.", "يسجّل المالكون والمسؤولون الدخول برمز من تطبيق الهاتف إضافة إلى كلمة المرور. دقيقتان، مرة واحدة."))}</p>
    {verified.length ? <><div className="toolbar" style={{ flexWrap: "nowrap" }}>
        <input className="input mono" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && ok()} aria-label={T(L("6-digit code", "6-значный код", "6-значний код", "رمز من 6 أرقام"))} />
        <button className="btn primary" disabled={busy || code.length !== 6} onClick={ok}>{T(L("Confirm", "Подтвердить", "Підтвердити", "تأكيد"))}</button></div>
        {err && <div className="sys-msg bad" role="alert">{err}</div>}
        <small className="faint">{T(L("Lost your phone? Another owner or administrator can reset your authenticator in Administration → Users.", "Потеряли телефон? Другой владелец или администратор может сбросить аутентификатор в «Администрирование → Пользователи».", "Втратили телефон? Інший власник або адміністратор може скинути автентифікатор в «Адміністрування → Користувачі».", "فقدت هاتفك؟ يستطيع مالك أو مسؤول آخر إعادة ضبط المصادقة من الإدارة ← المستخدمون."))}</small></>
      : <Enroll lang={lang} onDone={onDone} />}
    <button className="btn ghost" onClick={onSignOut}><Icon n="logout" />{T(L("Sign out", "Выйти", "Вийти", "تسجيل الخروج"))}</button>
  </div></div>;
}
