"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { ROLES } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { DEMO, Profile, store } from "@/lib/store";

export default function Admin() {
  const { lang, toast } = useApp();
  const [list, setList] = useState<Profile[]>([]);
  const [email, setEmail] = useState(""); const [role, setRole] = useState("engineering"); const [company, setCompany] = useState("");
  const load = () => store.profiles().then(setList).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const upd = async (p: Profile, patch: Partial<Profile>) => { try { await store.updateProfile(p.id, patch); toast(t("saved", lang)); load(); } catch (e: any) { toast(e.message || "Error", true); } };
  const invite = async () => {
    if (!email.trim()) return;
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    const r = await fetch("/api/admin/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), role, company: company.trim() || null }) });
    if (r.ok) { toast(t("invited", lang)); setEmail(""); setCompany(""); load(); } else toast(await r.text(), true);
  };
  const roleOpts = Object.entries(ROLES).map(([k, v]: any) => <option key={k} value={k}>{tx(v.label, lang)}</option>);

  return (
    <>
      <section className="card"><div className="card-h"><h2>{t("invite", lang)}</h2></div>
        <div className="card-b toolbar" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="inv-email">{t("email", lang)}</label><input id="inv-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="inv-role">{t("role", lang)}</label><select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>{roleOpts}</select></div>
          <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="inv-co">{t("company", lang)}</label><input id="inv-co" className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
          <button className="btn primary" onClick={invite}><Icon n="plus" />{t("invite", lang)}</button>
        </div></section>
      <section className="card"><div className="tablewrap"><table className="tb"><thead><tr><th>Name</th><th>{t("email", lang)}</th><th>{t("role", lang)}</th><th>{t("company", lang)}</th><th>{t("us_person", lang)}</th><th>{t("ai_limit_col", lang)}</th></tr></thead>
        <tbody>{list.map((p) => (
          <tr key={p.id}><td>{p.full_name}</td><td className="faint">{p.email}</td>
            <td><select className="input" style={{ width: "auto" }} value={p.role} onChange={(e) => upd(p, { role: e.target.value })} aria-label={t("role", lang)}>{roleOpts}</select></td>
            <td><input className="input" style={{ width: 180 }} defaultValue={p.company || ""} onBlur={(e) => e.target.value !== (p.company || "") && upd(p, { company: e.target.value || null })} aria-label={t("company", lang)} /></td>
            <td><input type="checkbox" checked={p.us_person} onChange={(e) => upd(p, { us_person: e.target.checked })} aria-label={t("us_person", lang)} /></td>
            <td><input className="input mono" style={{ width: 120 }} type="number" defaultValue={p.ai_monthly_tokens} onBlur={(e) => Number(e.target.value) !== p.ai_monthly_tokens && upd(p, { ai_monthly_tokens: Number(e.target.value) })} aria-label={t("ai_limit_col", lang)} /></td></tr>))}
        </tbody></table></div></section>
    </>
  );
}
