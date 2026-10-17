"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { t, tx } from "@/lib/i18n";
import { store, type TrashItem } from "@/lib/store";

/** Recycle bin: deleted records with their comments and files, kept 30 days. */
export default function Trash() {
  const { lang, me, people, toast, reload } = useApp();
  const [list, setList] = useState<TrashItem[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState("");
  const admin = ["owner", "admin"].includes(me.role);
  const load = () => store.trashList().then(setList).catch((e) => { toast(e.message, true); setList([]); });
  useEffect(() => { load(); }, []); // eslint-disable-line
  const name = (id: string | null) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.email : "—"; };
  const left = (at: string) => Math.max(0, 30 - Math.floor((Date.now() - Date.parse(at)) / 864e5));
  const act = async (a: "restore" | "purge", x: TrashItem) => {
    setBusy(x.id + a);
    try { await store.trashAct(a, x.id); toast(t(a === "restore" ? "restored" : "deleted", lang)); setAsk(""); await load(); if (a === "restore") reload(); }
    catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(""); }
  };
  const sec = (id: string) => SECTIONS.find((s) => s.id === id);
  const shown = (list || []).filter((x) => !q || (x.title + " " + tx(sec(x.section)?.label, lang)).toLowerCase().includes(q.toLowerCase()));
  return <div style={{ display: "grid", gap: 16, ["--dc" as any]: "#94A3B8" }}>
    <section className="sec-hero">
      <span className="ic"><Icon n="trash" /></span>
      <div style={{ position: "relative", zIndex: 1, minWidth: 0 }}><h2>{t("trash", lang)}</h2><div className="sec-desc">{t("trash_sub", lang)}</div></div>
      <div className="stats"><span className="stat"><b>{list?.length ?? "…"}</b><small>{t("records", lang)}</small></span></div>
    </section>
    <div className="card">
      <div className="filters" style={{ borderBottom: 0 }}><div className="search"><Icon n="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search", lang)} aria-label={t("search", lang)} /></div></div>
      {!list ? <div className="empty">…</div> : !shown.length ? <div className="empty">{t("trash_empty", lang)}</div> :
        <div className="feed">{shown.map((x) => { const s = sec(x.section); return (
          <div key={x.id} className="feed-row trash-row">
            <span className="flag" style={{ ["--dc" as any]: "#94A3B8" }}><Icon n={s?.icon || "file"} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ overflowWrap: "anywhere" }}>{x.title}</b>
              <div className="faint" style={{ fontSize: 13 }}>{s ? tx(s.label, lang) : x.section} · {t("deleted_by", lang)}: {name(x.deleted_by)} · {x.deleted_at.slice(0, 16).replace("T", " ")}{x.comments ? ` · ${x.comments} 💬` : ""}</div>
            </div>
            <span className={`chip ${left(x.deleted_at) <= 5 ? "c-warn" : ""}`}>{t("days_left", lang).replace("{n}", String(left(x.deleted_at)))}</span>
            {x.controlled && <span className="chip c-warn"><Icon n="lock" className="lockico" />{t("controlled_short", lang)}</span>}
            <div className="toolbar" style={{ flexWrap: "nowrap" }}>
              <button className="btn sm primary" disabled={!!busy} onClick={() => act("restore", x)}><Icon n="back" />{t("restore", lang)}</button>
              {admin && (ask === x.id
                ? <button className="btn sm danger" disabled={!!busy} onClick={() => act("purge", x)}>{t("purge_q", lang)}</button>
                : <button className="btn ghost sm danger" aria-label={t("purge", lang)} title={t("purge", lang)} onClick={() => setAsk(x.id)}><Icon n="trash" /></button>)}
            </div>
          </div>); })}</div>}
    </div>
    <p className="faint" style={{ fontSize: 13 }}>{tx({ en: "After restoring, open the record from its section:", ru: "После возврата запись открывается из своего раздела:", uk: "Після повернення запис відкривається зі свого розділу:", ar: "بعد الاستعادة افتح السجل من قسمه:" }, lang)} {Array.from(new Set((list || []).map((x) => x.section))).slice(0, 6).map((id) => <Link key={id} className="chip" style={{ marginInlineEnd: 6 }} href={`/${id.replace(".", "/")}`}>{tx(sec(id)?.label, lang)}</Link>)}</p>
  </div>;
}
