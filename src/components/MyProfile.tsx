"use client";
import { TIMEZONES, city, localTime } from "@/lib/tz";
import { NotifyCard } from "./Notify";
import { useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import PasswordInput from "./PasswordInput";
import CalendarLink from "./CalendarLink";
import InstallApp from "./InstallApp";
import { ROLES, ROLE_COLORS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { DEMO, sb, store } from "@/lib/store";

export default function MyProfile() {
  const { lang, me, toast, reload } = useApp();
  const [name, setName] = useState(me.full_name || "");
  const [title, setTitle] = useState(me.title || "");
  const [phone, setPhone] = useState(me.phone || "");
  const [tz, setTz] = useState(me.timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "") || "America/New_York");
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const c = (ROLE_COLORS as any)[me.role];
  const save = async () => { try { await store.updateProfile(me.id, { full_name: name.trim(), title: title.trim() || null, phone: phone.trim() || null, timezone: tz || null }); toast(t("saved", lang)); reload(); } catch (e: any) { toast(e.message || "Error", true); } };
  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast(t("pw_short", lang), true); return; }
    if (pw !== pw2) { toast(t("pw_mismatch", lang), true); return; }
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    const { error } = await sb().auth.updateUser({ password: pw });
    if (error) toast(error.message, true); else { toast(t("pw_saved", lang)); setPw(""); setPw2(""); }
  };

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: c }}>
      <section className="sec-hero">
        <span className="ic" style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 600 }}>{(name || me.email).slice(0, 1).toUpperCase()}</span>
        <div style={{ position: "relative", zIndex: 1 }}><div className="eyebrow" style={{ color: c }}>{tx((ROLES as any)[me.role]?.label, lang)}{me.company ? `, ${me.company}` : ""}</div><h2>{name || me.email}</h2><div className="sub">{me.email}</div></div>
        <div className="stats">{me.us_person && <span className="stat" style={{ cursor: "default" }}><b style={{ color: "var(--ok)" }}><Icon n="check" className="lockico" /></b><small>US person</small></span>}</div>
      </section>
      <section className="grid2">
        <div className="card"><div className="card-h"><h2><Icon n="user" />{t("my_profile", lang)}</h2></div>
          <div className="card-b" style={{ display: "grid", gap: 12 }}>
            <div className="field"><label htmlFor="p-name">{t("name", lang)}</label><input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="p-title">{t("job_title", lang)}</label><input id="p-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label htmlFor="p-phone">{t("phone", lang)}</label><input id="p-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 …" /></div>
            <div className="field"><label htmlFor="p-tz">{tx({ en: "Time zone", ru: "Часовой пояс", uk: "Часовий пояс", ar: "المنطقة الزمنية" }, lang)}</label>
              <select id="p-tz" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{Array.from(new Set([tz, ...TIMEZONES])).filter(Boolean).map((z) => <option key={z} value={z}>{city(z)} · {localTime(new Date(), z)}</option>)}</select>
              <span className="hint">{tx({ en: "The morning digest comes at about 8:00 your time; colleagues see your local time.", ru: "Утренняя сводка приходит около 8:00 по вашему времени; коллеги видят ваше местное время.", uk: "Ранкове зведення надходить близько 8:00 за вашим часом; колеги бачать ваш місцевий час.", ar: "يصل ملخص الصباح نحو الساعة 8:00 بتوقيتك؛ ويرى زملاؤك وقتك المحلي." }, lang)}</span></div>
            <div><button className="btn primary" onClick={save}>{t("save", lang)}</button></div>
            <p className="faint" style={{ margin: 0, fontSize: 14 }}><Icon n="mail" className="lockico" /> {t("company_sig", lang)}</p>
          </div></div>
        <div className="card"><div className="card-h"><h2><Icon n="key" />{t("set_pw", lang)}</h2></div>
          <form className="card-b" style={{ display: "grid", gap: 12 }} onSubmit={savePw}>
            <p className="faint" style={{ margin: 0 }}>{t("set_pw_hint", lang)}</p>
            <PasswordInput id="np" label={t("new_pw", lang)} value={pw} onChange={setPw} autoComplete="new-password" showLabel={t("show_pw", lang)} hideLabel={t("hide_pw", lang)} />
            <PasswordInput id="np2" label={t("repeat_pw", lang)} value={pw2} onChange={setPw2} autoComplete="new-password" showLabel={t("show_pw", lang)} hideLabel={t("hide_pw", lang)} />
            <p className="faint" style={{ margin: 0, fontSize: 14 }}>{t("pw_rule", lang)}</p>
            <div><button className="btn primary" type="submit">{t("save_pw", lang)}</button></div>
          </form></div>
      </section>
      <InstallApp />
      <NotifyCard />
      {!["partner", "vendor", "investor"].includes(me.role) && <CalendarLink />}
    </div>
  );
}
