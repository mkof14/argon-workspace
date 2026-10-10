"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { DEPARTMENTS, DEPT_COLORS, ROLES, ROLE_COLORS, ROLE_DESC } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { Profile, Rule, accessFor, isExternal, store } from "@/lib/store";

const EDIT_ROLES = Object.keys(ROLES).filter((r) => !["owner", "admin", "pending"].includes(r));

export default function Roles() {
  const { lang, toast, me, rules, setRules } = useApp();
  const [people, setPeople] = useState<Profile[]>([]);
  const [focus, setFocus] = useState("engineering");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const canEdit = me.role === "owner" || me.role === "admin";
  useEffect(() => { store.profiles().then(setPeople).catch(() => {}); }, []);
  const list: Rule[] = rules || [];
  const level = (sec: string, role: string) => { const r = list.find((x) => x.section === sec && x.role === role); return !r ? "none" : r.external ? "ext" : r.can_write ? "write" : "read"; };

  const cycle = async (sec: string, role: string) => {
    if (!canEdit) return;
    const cur = level(sec, role); const ext = isExternal(role);
    const next = ext ? (cur === "none" ? "read" : "none") : cur === "none" ? "read" : cur === "read" ? "write" : "none";
    setBusy(`${sec}|${role}`);
    try { await store.setRule(sec, role, next as any); setRules(await store.rules()); }
    catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  const reset = async () => { setConfirm(false); try { await store.resetRules(); setRules(await store.rules()); toast(t("saved", lang)); } catch (e: any) { toast(e.message || "Error", true); } };
  const focusAccess = useMemo(() => accessFor(focus, list), [focus, list]);

  return (
    <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#5B6CF0" }}>
      <section className="sec-hero">
        <span className="ic"><Icon n="key" /></span>
        <div style={{ position: "relative", zIndex: 1 }}><div className="eyebrow" style={{ color: "var(--dc)" }}>{t("admin", lang)}</div><h2>{t("roles", lang)}</h2>
          <div className="sub">{Object.keys(ROLES).length} · {SECTIONS.length} {t("sections_n", lang)}</div></div>
        <div className="stats"><Link className="btn" href="/admin/users"><Icon n="users" />{t("users", lang)}</Link></div>
      </section>

      <section className="role-cards">
        {Object.entries(ROLES).map(([k, r]: any) => {
          const n = people.filter((p) => p.role === k).length;
          return <button key={k} className={`role-card ${focus === k ? "on" : ""}`} style={{ ["--rc" as any]: (ROLE_COLORS as any)[k] }} onClick={() => setFocus(k)}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="role-dot" /><b style={{ flex: 1 }}>{tx(r.label, lang)}</b><span className="n">{n}</span></div>
            <span className="faint" style={{ fontSize: 13 }}>{tx((ROLE_DESC as any)[k], lang)}</span>
            {!r.internal && <span className="chip" style={{ justifySelf: "start" }}>{t("external", lang)}</span>}
          </button>;
        })}
      </section>

      <section className="card" style={{ ["--rc" as any]: (ROLE_COLORS as any)[focus] }}>
        <div className="card-h"><h2><span className="role-dot" />{tx((ROLES as any)[focus].label, lang)} · {t("access_of", lang)}</h2>
          <span className="chip c-info">R {[...focusAccess.read].filter((s) => !focusAccess.write.has(s)).length}</span><span className="chip c-ok">W {focusAccess.write.size}</span></div>
        <div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {focus === "owner" || focus === "admin" ? <span className="chip c-ok">{SECTIONS.length} {t("sections_n", lang)} · W</span> :
            SECTIONS.filter((s) => focusAccess.read.has(s.id)).map((s) => (
              <span key={s.id} className="chip" style={{ borderColor: (DEPT_COLORS as any)[s.dept], color: (DEPT_COLORS as any)[s.dept], background: `color-mix(in srgb,${(DEPT_COLORS as any)[s.dept]} 10%,var(--surface))` }}>
                <Icon n={s.icon} className="lockico" />{tx(s.label, lang)}{focusAccess.write.has(s.id) ? " · W" : ""}</span>))}
          {focus === "pending" && <span className="faint">—</span>}
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2><Icon n="grid" />{t("roles", lang)}</h2><span style={{ flex: 1 }} />
          {canEdit && (confirm ? <><span className="faint" style={{ fontSize: 14 }}>{t("reset_confirm", lang)}</span><button className="btn danger sm" onClick={reset}>{t("reset_defaults", lang)}</button><button className="btn ghost sm" onClick={() => setConfirm(false)}>{t("cancel", lang)}</button></>
            : <button className="btn ghost sm" onClick={() => setConfirm(true)}><Icon n="sort" />{t("reset_defaults", lang)}</button>)}</div>
        <div className="card-b" style={{ paddingBottom: 6 }}><div className="faint" style={{ fontSize: 14 }}>{t("matrix_hint", lang)}</div></div>
        <div className="tablewrap" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="matrix"><thead><tr><th>{t("departments", lang)}</th>{EDIT_ROLES.map((r) => <th key={r} style={{ color: (ROLE_COLORS as any)[r] }} title={tx((ROLES as any)[r].label, lang)}>{tx((ROLES as any)[r].label, lang)}</th>)}</tr></thead>
            <tbody>{DEPARTMENTS.map((d: any) => [
              <tr key={d.key} className="dep" style={{ ["--dc" as any]: (DEPT_COLORS as any)[d.key] }}><td colSpan={EDIT_ROLES.length + 1}><Icon n={d.icon} className="lockico" /> {tx(d.label, lang)}</td></tr>,
              ...SECTIONS.filter((s) => s.dept === d.key).map((s) => (
                <tr key={s.id}><td style={{ paddingInlineStart: 22 }}>{tx(s.label, lang)}</td>
                  {EDIT_ROLES.map((r) => { const l = level(s.id, r); return <td key={r}>
                    <button className={`cellbtn ${l === "read" ? "r" : l === "write" ? "w" : l === "ext" ? "x" : ""}`} disabled={!canEdit || busy === `${s.id}|${r}`} onClick={() => cycle(s.id, r)}
                      aria-label={`${tx(s.label, lang)} · ${tx((ROLES as any)[r].label, lang)}: ${l}`}>{l === "read" ? "R" : l === "write" ? "W" : l === "ext" ? "E" : "—"}</button></td>; })}
                </tr>)),
            ])}</tbody></table>
        </div>
      </section>
    </div>
  );
}
