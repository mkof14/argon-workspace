"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp } from "./App";
import { ROLES, ROLE_COLORS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { DEMO, Profile, isExternal, store } from "@/lib/store";
import { FullExport } from "./DataTools";

export default function Admin() {
  const { lang, toast, me } = useApp();
  const [list, setList] = useState<Profile[]>([]);
  const [emails, setEmails] = useState(""); const [role, setRole] = useState("engineering"); const [company, setCompany] = useState("");
  const [q, setQ] = useState(""); const [rf, setRf] = useState("");
  const [sel, setSel] = useState<Record<string, boolean>>({}); const [bulk, setBulk] = useState("engineering");
  const [busy, setBusy] = useState(false);
  const load = () => store.profiles().then(setList).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const owners = list.filter((p) => p.role === "owner").length;
  const upd = async (p: Profile, patch: Partial<Profile>) => {
    if (patch.role && p.role === "owner" && patch.role !== "owner" && owners <= 1) { toast(t("last_owner", lang), true); return; }
    try { await store.updateProfile(p.id, patch); toast(t("saved", lang)); load(); } catch (e: any) { toast(e.message || "Error", true); }
  };
  const invite = async () => {
    const all = emails.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (!all.length) return;
    if (DEMO) { toast(t("ai_demo", lang), true); return; }
    setBusy(true); let ok = 0;
    for (const email of all) {
      const r = await fetch("/api/admin/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role, company: company.trim() || null }) });
      if (r.ok) ok++; else toast(`${email}: ${await r.text()}`, true);
    }
    setBusy(false); if (ok) { toast(`${t("invited", lang)}: ${ok}`); setEmails(""); setCompany(""); load(); }
  };
  const applyBulk = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    for (const id of ids) { const p = list.find((x) => x.id === id); if (p && p.id !== me.id && !p.super) await upd(p, { role: bulk }); }
    setSel({});
  };
  const roleOpts = Object.entries(ROLES).map(([k, v]: any) => <option key={k} value={k}>{tx(v.label, lang)}</option>);
  const shown = list.filter((p) => (!rf || p.role === rf) && (!q || `${p.full_name} ${p.email} ${p.company || ""} ${p.title || ""}`.toLowerCase().includes(q.toLowerCase())));
  const nSel = Object.values(sel).filter(Boolean).length;
  const pending = list.filter((p) => p.role === "pending").length;

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#5B6CF0" }}>
      <section className="sec-hero">
        <span className="ic"><Icon n="users" /></span>
        <div style={{ position: "relative", zIndex: 1 }}><div className="eyebrow" style={{ color: "var(--dc)" }}>{t("admin", lang)}</div><h2>{t("users", lang)}</h2>
          <div className="sub"><b className="mono">{list.length}</b> {t("members", lang)}{pending ? <> · <span style={{ color: "var(--warn)", fontWeight: 600 }}>{pending} {tx((ROLES as any).pending.label, lang)}</span></> : null}</div></div>
        <div className="stats"><Link className="btn" href="/admin/roles"><Icon n="key" />{t("roles", lang)}</Link></div>
      </section>

      <section className="card"><div className="card-h"><h2><Icon n="userplus" />{t("invite", lang)}</h2></div>
        <div className="card-b toolbar" style={{ alignItems: "flex-end", gap: 12 }}>
          <div className="field" style={{ flex: "3 1 300px" }}><label htmlFor="inv-email">{t("email", lang)}</label><textarea id="inv-email" className="input" rows={2} style={{ minHeight: 48 }} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="anna@agron1.com, oleg@agron1.com" /><span className="hint">{t("invite_hint", lang)}</span></div>
          <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="inv-role">{t("role", lang)}</label><select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>{roleOpts}</select></div>
          <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="inv-co">{t("company", lang)}</label><input id="inv-co" className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={isExternal(role) ? "Partner Co." : ""} /></div>
          <button className="btn primary" disabled={busy} onClick={invite}><Icon n="send" />{busy ? "…" : t("invite", lang)}</button>
        </div></section>

      <section className="card">
        <div className="filters">
          <div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search", lang)} aria-label={t("search", lang)} /></div>
          <div className="toolbar">
            <button className={`chip ${!rf ? "c-accent" : ""}`} style={{ cursor: "pointer" }} onClick={() => setRf("")}>{t("all_roles", lang)} · {list.length}</button>
            {Object.keys(ROLES).map((k) => { const n = list.filter((p) => p.role === k).length; return n ? <button key={k} className="chip" style={{ cursor: "pointer", color: (ROLE_COLORS as any)[k], borderColor: rf === k ? (ROLE_COLORS as any)[k] : undefined, background: `color-mix(in srgb,${(ROLE_COLORS as any)[k]} 12%,var(--surface))` }} onClick={() => setRf(rf === k ? "" : k)}>{tx((ROLES as any)[k].label, lang)} · {n}</button> : null; })}
          </div>
        </div>
        {nSel > 0 && <div className="banner" style={{ margin: 12 }}><b>{nSel} {t("selected", lang)}</b><span>{t("assign_role", lang)}:</span>
          <select className="input" style={{ width: "auto" }} value={bulk} onChange={(e) => setBulk(e.target.value)}>{roleOpts}</select>
          <button className="btn primary sm" onClick={applyBulk}>{t("apply", lang)}</button><button className="btn ghost sm" onClick={() => setSel({})}>{t("cancel", lang)}</button></div>}
        <div className="tablewrap"><table className="tb"><thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="all" checked={shown.length > 0 && shown.every((p) => sel[p.id])} onChange={(e) => setSel(Object.fromEntries(shown.map((p) => [p.id, e.target.checked])))} /></th>
          <th>{t("name", lang)}</th><th>{t("email", lang)}</th><th>{t("job_title", lang)}</th><th>{t("role", lang)}</th><th>{t("company", lang)}</th><th>{t("us_person", lang)}</th><th>{t("ai_limit_col", lang)}</th></tr></thead>
          <tbody>{shown.map((p) => { const c = (ROLE_COLORS as any)[p.role]; return (
            <tr key={p.id} style={p.role === "pending" ? { background: "color-mix(in srgb,var(--warn) 7%,transparent)" } : undefined}>
              <td><input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel({ ...sel, [p.id]: e.target.checked })} aria-label={p.email} /></td>
              <td><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><span className="avatar" style={{ background: `color-mix(in srgb,${c} 18%,var(--surface))`, color: c, borderColor: "transparent", width: 34, height: 34, fontSize: 14 }}>{(p.full_name || p.email || "?").slice(0, 1).toUpperCase()}</span><b style={{ fontWeight: 600 }}>{p.full_name}</b>{p.super && <span className="chip c-ok" title={t("protected_owner", lang)}><Icon n="lock" className="lockico" />{t("protected_owner", lang)}</span>}</span></td>
              <td className="faint">{p.email}</td>
              <td className="faint">{p.title || ""}</td>
              <td><select className="input" style={{ width: "auto", color: c, fontWeight: 600, borderColor: `color-mix(in srgb,${c} 45%,var(--line))` }} value={p.role} disabled={!!p.super || (p.id === me.id && p.role === "owner" && owners <= 1)} onChange={(e) => upd(p, { role: e.target.value })} aria-label={t("role", lang)}>{roleOpts}</select></td>
              <td><input className="input" style={{ width: 170 }} defaultValue={p.company || ""} onBlur={(e) => e.target.value !== (p.company || "") && upd(p, { company: e.target.value || null })} aria-label={t("company", lang)} /></td>
              <td style={{ textAlign: "center" }}><input type="checkbox" style={{ width: 18, height: 18 }} disabled={!!p.super} checked={p.us_person} onChange={(e) => upd(p, { us_person: e.target.checked })} aria-label={t("us_person", lang)} /></td>
              <td><input className="input mono" style={{ width: 120 }} type="number" step={100000} defaultValue={p.ai_monthly_tokens} onBlur={(e) => Number(e.target.value) !== p.ai_monthly_tokens && upd(p, { ai_monthly_tokens: Number(e.target.value) })} aria-label={t("ai_limit_col", lang)} /></td></tr>); })}
          </tbody></table></div>
      </section>
      {me.role === "owner" && <FullExport />}
    </div>
  );
}
