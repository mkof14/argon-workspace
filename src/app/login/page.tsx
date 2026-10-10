"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO, sb } from "@/lib/store";
import { LANGS, Lang, t } from "@/lib/i18n";

export default function Login() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (DEMO) router.replace("/"); try { const l = localStorage.getItem("agronws.lang") as Lang; if (l) setLang(l); } catch {} }, [router]);
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

  const magic = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
    if (error) setErr(error.message); else setSent(true);
  };
  const oauth = async (provider: "azure" | "google") => {
    const { error } = await sb().auth.signInWithOAuth({ provider, options: { redirectTo, scopes: provider === "azure" ? "email" : undefined } });
    if (error) setErr(error.message);
  };

  return (
    <div className="login" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="box">
        <div className="brand"><img src="/logo-full.webp" alt="AGRON — Aerial-Ground Robotics Operations Network" /></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 18 }}>{t("sign_in", lang)} · {t("workspace", lang)}</h2>
          <select className="input" style={{ width: "auto" }} value={lang} onChange={(e) => { setLang(e.target.value as Lang); try { localStorage.setItem("agronws.lang", e.target.value); } catch {} }} aria-label={t("language", lang)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <button className="btn" onClick={() => oauth("azure")} style={{ justifyContent: "center" }}>{t("with_ms", lang)}</button>
        <button className="btn" onClick={() => oauth("google")} style={{ justifyContent: "center" }}>{t("with_google", lang)}</button>
        <form onSubmit={magic} className="field">
          <label htmlFor="email">{t("email", lang)}</label>
          <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" style={{ justifyContent: "center", marginTop: 6 }} type="submit">{t("magic", lang)}</button>
        </form>
        {sent && <div className="banner">{t("magic_sent", lang)}</div>}
        {err && <div className="gate-msg">{err}</div>}
        <div className="faint" style={{ fontSize: 11.5 }}>© 2026 AGRON Inc. · {t("foot_conf", lang)}</div>
      </div>
    </div>
  );
}
