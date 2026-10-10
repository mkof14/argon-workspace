"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import RecordDrawer from "./RecordDrawer";
import { t, tx } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import { fmt, saveBlob, toCsv, tone } from "@/lib/format";

export default function SectionView({ section }: { section: any }) {
  const { lang, access, toast, openAi, tick } = useApp();
  const [rows, setRows] = useState<Rec[] | null>(null);
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  const [view, setView] = useState<"table" | "board">(section.board ? "board" : "table");
  const [open, setOpen] = useState<Rec | "new" | null>(null);
  const [dragOver, setDragOver] = useState("");
  const canWrite = access.write.has(section.id);
  const fieldsByKey = useMemo(() => Object.fromEntries(section.fields.map((f: any) => [f.key, f])), [section]);

  const load = async () => { try { setRows(await store.list(section.id)); } catch (e: any) { toast(e.message || "Error", true); setRows([]); } };
  useEffect(() => { load(); }, [section.id, tick]); // eslint-disable-line
  useEffect(() => { // deep link ?r=<id>
    if (!rows) return; const id = new URLSearchParams(window.location.search).get("r");
    if (id) { const r = rows.find((x) => x.id === id); if (r) setOpen(r); }
  }, [rows]);

  const filtered = (rows || []).filter((r) => (!st || r.status === st) && (!q || (r.title + " " + JSON.stringify(r.data)).toLowerCase().includes(q.toLowerCase())));

  const moveTo = async (r: Rec, status: string) => {
    if (!canWrite || r.status === status) return;
    const g = section.gate;
    if (g && status === g.status && r.data?.[g.field] !== g.equals) { toast(tx(g.msg, lang), true); return; }
    try { await store.save({ ...r, status }); toast(t("saved", lang)); load(); } catch (e: any) { toast(e.message || "Error", true); }
  };

  const cell = (r: Rec, key: string) => {
    const f = fieldsByKey[key]; const v = r.data?.[key];
    if (f?.type === "select" && v) return <span className={`chip ${tone(v)}`}>{v}</span>;
    if (f?.type === "url" && v) return <a href={v} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>↗</a>;
    return <span className={f?.type === "money" || f?.type === "number" ? "mono" : ""}>{fmt(f, v, lang)}</span>;
  };

  return (
    <>
      <div className="toolbar">
        {canWrite && <button className="btn primary" onClick={() => setOpen("new")}><Icon n="plus" />{t("new", lang)}</button>}
        <div className="seg" role="group">
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}><Icon n="list" /> {t("table", lang)}</button>
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>{t("board", lang)}</button>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => openAi({ title: tx(section.label, lang), section: section.id, rows: filtered.slice(0, 60) })}><Icon n="spark" />{t("ask_ai", lang)}</button>
        <button className="btn ghost sm" onClick={() => saveBlob(`AGRON_${section.id}_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(section, filtered, lang), "text/csv;charset=utf-8")}><Icon n="download" />{t("export_csv", lang)}</button>
      </div>

      <section className="card">
        <div className="filters">
          <div className="search"><Icon n="search" /><input className="input" type="search" placeholder={t("search", lang)} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search", lang)} /></div>
          <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label={t("all_status", lang)}>
            <option value="">{t("all_status", lang)}</option>{section.statuses.map((s: string) => <option key={s}>{s}</option>)}
          </select>
        </div>

        {rows === null ? <div className="empty">…</div> : !rows.length ? (
          <div className="empty"><b>{t("empty", lang)}</b>{canWrite ? t("empty_p", lang) : ""}</div>
        ) : view === "table" ? (
          <>
            <div className="tablewrap"><table className="tb"><thead><tr>
              <th>{t("title", lang)}</th><th>{t("status", lang)}</th>
              {section.columns.map((k: string) => <th key={k}>{tx(fieldsByKey[k]?.label, lang)}</th>)}<th>{t("updated", lang)}</th>
            </tr></thead><tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="row" tabIndex={0} onClick={() => setOpen(r)} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                  <td style={{ fontWeight: 500 }}>{r.controlled && <Icon n="lock" className="lockico" />} {r.title} {r.data?.sample && <span className="chip c-vio" style={{ marginInlineStart: 6 }}>{t("sample", lang)}</span>}</td>
                  <td>{r.status && <span className={`chip dot ${tone(r.status)}`}>{r.status}</span>}</td>
                  {section.columns.map((k: string) => <td key={k}>{cell(r, k)}</td>)}
                  <td className="faint mono" style={{ fontSize: 12 }}>{(r.updated_at || "").slice(0, 10)}</td>
                </tr>))}
            </tbody></table></div>
            {!filtered.length && <div className="empty">{t("no_match", lang)}</div>}
            <div className="tfoot"><span><b className="mono">{filtered.length}</b> / {rows.length} {t("records", lang)}</span></div>
          </>
        ) : (
          <div className="boardwrap"><div className="board">
            {section.statuses.map((s: string) => {
              const items = filtered.filter((r) => r.status === s);
              return (
                <div key={s} className={`col ${dragOver === s ? "drop" : ""}`}
                  onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDragOver(s); } }} onDragLeave={() => setDragOver("")}
                  onDrop={(e) => { e.preventDefault(); setDragOver(""); const r = rows.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (r) moveTo(r, s); }}>
                  <h3><span className={`chip dot ${tone(s)}`}>{s}</span><span className="mono faint">{items.length}</span></h3>
                  {items.map((r) => (
                    <div key={r.id} className="tile" draggable={canWrite} onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                      <b>{r.controlled && <Icon n="lock" className="lockico" />} {r.title}</b>
                      <div className="meta">{section.columns.slice(0, 3).map((k: string) => r.data?.[k] ? <span key={k} className="chip">{fmt(fieldsByKey[k], r.data[k], lang)}</span> : null)}
                        {r.data?.sample && <span className="chip c-vio">{t("sample", lang)}</span>}</div>
                    </div>))}
                </div>);
            })}
          </div></div>
        )}
      </section>
      {open && <RecordDrawer section={section} rec={open === "new" ? null : open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
      <style>{`.lockico{width:13px;height:13px;color:var(--warn);vertical-align:-2px}`}</style>
    </>
  );
}
