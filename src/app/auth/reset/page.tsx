"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/sb";
import { Lang, t } from "@/lib/i18n";
import { loadUiLang } from "@/lib/i18n";
import RadarScene from "@/components/RadarScene";
import PasswordInput from "@/components/PasswordInput";

export default function ResetPassword() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { try { const l = localStorage.getItem("agronws.lang") as Lang; if (l) loadUiLang(l).then(() => setLang(l), () => setLang(l)); } catch {} }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (pw.length < 8) { setErr(t("pw_short", lang)); return; }
    if (pw !== pw2) { setErr(t("pw_mismatch", lang)); return; }
    setBusy(true);
    const { error } = await sb().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(/session/i.test(error.message) ? t("reset_expired", lang) : error.message); else router.replace("/");
  };
  return (
    <div className="auth" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <RadarScene />
      <div className="auth-side"><img src="/logo-full.webp" alt="AGRON™ — Aerial-Ground Robotics Operations Network" width={1000} height={280} /></div>
      <main className="auth-box">
        <div className="auth-top"><h1>{t("new_pw", lang)}</h1></div>
        <form onSubmit={save} className="auth-form">
          <PasswordInput id="pw" label={t("new_pw", lang)} value={pw} onChange={setPw} autoComplete="new-password" showLabel={t("show_pw", lang)} hideLabel={t("hide_pw", lang)} />
          <PasswordInput id="pw2" label={t("repeat_pw", lang)} value={pw2} onChange={setPw2} autoComplete="new-password" showLabel={t("show_pw", lang)} hideLabel={t("hide_pw", lang)} />
          <p className="faint" style={{ margin: 0 }}>{t("pw_rule", lang)}</p>
          <button className="btn primary big" type="submit" disabled={busy}>{busy ? "…" : t("save_pw", lang)}</button>
        </form>
        {err && <div className="gate-msg" role="alert">{err}</div>}
      </main>
    </div>
  );
}
