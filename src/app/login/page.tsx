"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO, sb } from "@/lib/sb";
import { LANGS, Lang, t } from "@/lib/i18n";
import { loadUiLang } from "@/lib/i18n";
import Icon from "@/components/Icon";
import RadarScene from "@/components/RadarScene";
import PasswordInput from "@/components/PasswordInput";

import { SUPA_KEY, SUPA_URL } from "@/lib/sb";

type Provider = "google" | "azure" | "apple";
const PROVIDERS: { id: Provider; key: string; mark: React.ReactElement }[] = [
  { id: "google", key: "with_google", mark: <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> },
  { id: "azure", key: "with_ms", mark: <svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true"><path fill="#F25022" d="M1 1h9v9H1z"/><path fill="#7FBA00" d="M11 1h9v9h-9z"/><path fill="#00A4EF" d="M1 11h9v9H1z"/><path fill="#FFB900" d="M11 11h9v9h-9z"/></svg> },
  { id: "apple", key: "with_apple", mark: <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="currentColor"><path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.41-3.64zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.68-1.28z"/></svg> },
];
type Mode = "password" | "link" | "forgot";

export default function Login() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState<"" | "email" | "recovery">("");
  const [err, setErr] = useState("");
  const [enabled, setEnabled] = useState<Provider[]>([]);
  useEffect(() => {
    if (DEMO) { router.replace("/"); return; }
    // Already signed in on this device? Go straight to the workspace.
    sb().auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
    // Show only the sign-in providers that are switched on in Supabase
    fetch(`${SUPA_URL}/auth/v1/settings`, { headers: { apikey: SUPA_KEY } }).then((r) => r.json())
      .then((j) => setEnabled(PROVIDERS.map((p) => p.id).filter((id) => j?.external?.[id]))).catch(() => {});
    try { const l = localStorage.getItem("agronws.lang") as Lang; if (l) loadUiLang(l).then(() => setLang(l), () => setLang(l)); } catch {}
    const e = new URLSearchParams(location.search).get("error_description"); if (e) setErr(e);
  }, [router]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const friendly = (m: string) => /invalid login/i.test(m) ? t("err_login", lang) : /rate limit/i.test(m) ? t("err_rate", lang) : /not confirmed/i.test(m) ? t("err_confirm", lang) : m;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      if (codeSent) { // 6-digit code from the email: works on any device, no link needed
        const { error } = await sb().auth.verifyOtp({ email, token: code.trim(), type: codeSent });
        if (error) throw error;
        router.replace(codeSent === "recovery" ? "/auth/reset" : "/"); return;
      }
      if (mode === "password") {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw error; router.replace("/"); return;
      }
      if (mode === "link") {
        const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: true } });
        if (error) throw error; setMsg(t("code_sent", lang)); setCodeSent("email");
      }
      if (mode === "forgot") {
        const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/reset` });
        if (error) throw error; setMsg(t("code_sent", lang)); setCodeSent("recovery");
      }
    } catch (e: any) { setErr(friendly(e.message || "Error")); } finally { setBusy(false); }
  };
  const switchMode = (m: Mode) => { setMode(m); setErr(""); setMsg(""); setCodeSent(""); setCode(""); };
  const oauth = async (provider: Provider) => {
    const { error } = await sb().auth.signInWithOAuth({ provider, options: { redirectTo: `${origin}/auth/callback`, scopes: provider === "azure" ? "email openid profile" : undefined } });
    if (error) setErr(error.message);
  };
  const pickLang = (l: Lang) => { loadUiLang(l).then(() => setLang(l), () => setLang(l)); try { localStorage.setItem("agronws.lang", l); } catch {} };

  return (
    <div className="auth" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <RadarScene />
      <div className="auth-side">
        <img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} />
        <p>{t("auth_tag", lang)}</p>
      </div>
      <main className="auth-box">
        <div className="auth-top">
          <h1>{mode === "forgot" ? t("forgot_t", lang) : t("sign_in", lang)}</h1>
          <select className="input" style={{ width: "auto" }} value={lang} onChange={(e) => pickLang(e.target.value as Lang)} aria-label={t("language", lang)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        {mode !== "forgot" && <div className="seg auth-seg" role="tablist">
          <button role="tab" aria-selected={mode === "password"} className={mode === "password" ? "on" : ""} onClick={() => switchMode("password")}><Icon n="key" />{t("with_password", lang)}</button>
          <button role="tab" aria-selected={mode === "link"} className={mode === "link" ? "on" : ""} onClick={() => switchMode("link")}><Icon n="mail" />{t("with_link", lang)}</button>
        </div>}
        <form onSubmit={submit} className="auth-form">
          <div className="field"><label htmlFor="email">{t("email", lang)}</label>
            <input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@agron1.com" /></div>
          {mode === "password" && <PasswordInput id="password" label={t("password", lang)} value={password} onChange={setPassword} showLabel={t("show_pw", lang)} hideLabel={t("hide_pw", lang)} />}
          {mode === "password" && <button type="button" className="linkbtn" onClick={() => switchMode("forgot")}>{t("forgot", lang)}</button>}
          {codeSent && <div className="field"><label htmlFor="code">{t("code_label", lang)}</label>
            <input id="code" className="input code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" autoFocus /></div>}
          {mode === "link" && !codeSent && <p className="faint" style={{ margin: 0 }}>{t("link_hint", lang)}</p>}
          {mode === "forgot" && <p className="faint" style={{ margin: 0 }}>{t("forgot_hint", lang)}</p>}
          <button className="btn primary big" type="submit" disabled={busy}>{busy ? "…" : codeSent ? t("sign_in", lang) : mode === "password" ? t("sign_in", lang) : mode === "link" ? t("send_code", lang) : t("send_reset", lang)}</button>
          {mode === "forgot" && <button type="button" className="linkbtn" onClick={() => switchMode("password")}>{t("back_signin", lang)}</button>}
        </form>
        {msg && <div className="banner" role="status"><Icon n="mail" /><span>{msg}</span></div>}
        {err && <div className="gate-msg" role="alert">{err}</div>}
        {enabled.length > 0 && mode !== "forgot" && <>
          <div className="auth-or"><span>{t("or", lang)}</span></div>
          <div className="auth-oauth">{PROVIDERS.filter((p) => enabled.includes(p.id)).map((p) => (
            <button key={p.id} type="button" className={`btn oauth-${p.id}`} onClick={() => oauth(p.id)}>{p.mark}{t(p.key, lang)}</button>))}</div>
        </>}
        <div className="faint auth-foot">© {new Date().getFullYear()} AGRON Inc. · {t("foot_conf", lang)}</div>
      </main>
    </div>
  );
}
