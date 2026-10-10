"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO, sb } from "@/lib/sb";
import { LANGS, Lang, t } from "@/lib/i18n";
import Icon from "@/components/Icon";
import RadarScene from "@/components/RadarScene";
import PasswordInput from "@/components/PasswordInput";

const OAUTH = (process.env.NEXT_PUBLIC_OAUTH || "").split(",").map((x) => x.trim()).filter(Boolean);
type Mode = "password" | "link" | "forgot";

export default function Login() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (DEMO) router.replace("/");
    try { const l = localStorage.getItem("agronws.lang") as Lang; if (l) setLang(l); } catch {}
    const e = new URLSearchParams(location.search).get("error_description"); if (e) setErr(e);
  }, [router]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const friendly = (m: string) => /invalid login/i.test(m) ? t("err_login", lang) : /rate limit/i.test(m) ? t("err_rate", lang) : /not confirmed/i.test(m) ? t("err_confirm", lang) : m;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      if (mode === "password") {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw error; router.replace("/"); return;
      }
      if (mode === "link") {
        const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: true } });
        if (error) throw error; setMsg(t("magic_sent", lang));
      }
      if (mode === "forgot") {
        const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/reset` });
        if (error) throw error; setMsg(t("reset_sent", lang));
      }
    } catch (e: any) { setErr(friendly(e.message || "Error")); } finally { setBusy(false); }
  };
  const oauth = async (provider: "azure" | "google") => {
    const { error } = await sb().auth.signInWithOAuth({ provider, options: { redirectTo: `${origin}/auth/callback`, scopes: provider === "azure" ? "email" : undefined } });
    if (error) setErr(error.message);
  };
  const pickLang = (l: Lang) => { setLang(l); try { localStorage.setItem("agronws.lang", l); } catch {} };

  return (
    <div className="auth" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <RadarScene />
      <div className="auth-side">
        <img src="/logo-full.webp" alt="AGRON — Aerial-Ground Robotics Operations Network" width={640} height={187} />
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
          <button role="tab" aria-selected={mode === "password"} className={mode === "password" ? "on" : ""} onClick={() => { setMode("password"); setMsg(""); setErr(""); }}><Icon n="key" />{t("with_password", lang)}</button>
          <button role="tab" aria-selected={mode === "link"} className={mode === "link" ? "on" : ""} onClick={() => { setMode("link"); setMsg(""); setErr(""); }}><Icon n="mail" />{t("with_link", lang)}</button>
        </div>}
        <form onSubmit={submit} className="auth-form">
          <div className="field"><label htmlFor="email">{t("email", lang)}</label>
            <input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@agron1.com" /></div>
          {mode === "password" && <PasswordInput id="password" label={t("password", lang)} value={password} onChange={setPassword} showLabel={t("show_pw", lang)} hideLabel={t("hide_pw", lang)} />}
          {mode === "password" && <button type="button" className="linkbtn" onClick={() => { setMode("forgot"); setErr(""); setMsg(""); }}>{t("forgot", lang)}</button>}
          {mode === "link" && <p className="faint" style={{ margin: 0 }}>{t("link_hint", lang)}</p>}
          {mode === "forgot" && <p className="faint" style={{ margin: 0 }}>{t("forgot_hint", lang)}</p>}
          <button className="btn primary big" type="submit" disabled={busy}>{busy ? "…" : mode === "password" ? t("sign_in", lang) : mode === "link" ? t("magic", lang) : t("send_reset", lang)}</button>
          {mode === "forgot" && <button type="button" className="linkbtn" onClick={() => { setMode("password"); setErr(""); setMsg(""); }}>{t("back_signin", lang)}</button>}
        </form>
        {msg && <div className="banner" role="status"><Icon n="mail" /><span>{msg}</span></div>}
        {err && <div className="gate-msg" role="alert">{err}</div>}
        {OAUTH.length > 0 && mode !== "forgot" && <div className="auth-oauth">
          {OAUTH.includes("azure") && <button className="btn" onClick={() => oauth("azure")}>{t("with_ms", lang)}</button>}
          {OAUTH.includes("google") && <button className="btn" onClick={() => oauth("google")}>{t("with_google", lang)}</button>}
        </div>}
        <div className="faint auth-foot">© {new Date().getFullYear()} AGRON Inc. · {t("foot_conf", lang)}</div>
      </main>
    </div>
  );
}
