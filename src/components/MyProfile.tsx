"use client";
import { useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { ROLES, ROLE_COLORS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { store } from "@/lib/store";
import { renderEmail } from "@/lib/mail";

export default function MyProfile() {
  const { lang, me, toast, reload } = useApp();
  const [name, setName] = useState(me.full_name || "");
  const [title, setTitle] = useState(me.title || "");
  const [phone, setPhone] = useState(me.phone || "");
  const c = (ROLE_COLORS as any)[me.role];
  const save = async () => { try { await store.updateProfile(me.id, { full_name: name.trim(), title: title.trim() || null, phone: phone.trim() || null }); toast(t("saved", lang)); reload(); } catch (e: any) { toast(e.message || "Error", true); } };
  const preview = renderEmail({ subject: "AGRON", body: "…", lang, sender: { name: name || me.email, title, email: me.email, phone } });

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: c }}>
      <section className="sec-hero">
        <span className="ic" style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 600 }}>{(name || me.email).slice(0, 1).toUpperCase()}</span>
        <div style={{ position: "relative", zIndex: 1 }}><div className="eyebrow" style={{ color: c }}>{tx((ROLES as any)[me.role]?.label, lang)}{me.company ? ` · ${me.company}` : ""}</div><h2>{name || me.email}</h2><div className="sub">{me.email}</div></div>
        <div className="stats">{me.us_person && <span className="stat" style={{ cursor: "default" }}><b style={{ color: "var(--ok)" }}><Icon n="check" className="lockico" /></b><small>US person</small></span>}</div>
      </section>
      <section className="grid2">
        <div className="card"><div className="card-h"><h2><Icon n="user" />{t("my_profile", lang)}</h2></div>
          <div className="card-b" style={{ display: "grid", gap: 12 }}>
            <div className="field"><label htmlFor="p-name">{t("name", lang)}</label><input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="p-title">{t("job_title", lang)}</label><input id="p-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Head of Operations" /></div>
            <div className="field"><label htmlFor="p-phone">{t("phone", lang)}</label><input id="p-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 …" /></div>
            <div><button className="btn primary" onClick={save}>{t("save", lang)}</button></div>
          </div></div>
        <div className="card"><div className="card-h"><h2><Icon n="mail" />{t("signature", lang)}</h2></div>
          <div className="card-b"><iframe title={t("signature", lang)} className="mailframe" style={{ height: 420 }} srcDoc={preview} sandbox="" /></div></div>
      </section>
    </div>
  );
}
