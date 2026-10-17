"use client";
import { useEffect, useMemo, useState } from "react";
// Loaded when needed: the record form (with PDF, markdown and AI tools) and the template list are not part of the first page load
const RecordDrawer = dynamic(() => import("./RecordDrawer"), { ssr: false });
const SectionTemplates = dynamic(() => import("./Templates").then((m) => m.SectionTemplates), { ssr: false });
import Icon from "./Icon";
import { PEOPLE_KEYS } from "@/lib/insights";
import { useApp } from "./App";
import dynamic from "next/dynamic";
const MailCenter = dynamic(() => import("./Mail"), { ssr: false });
const LegalHub = dynamic(() => import("./LegalHub"), { ssr: false });
import { CsvImport } from "./DataTools";
import BrandLogos from "./BrandLogos";
import ChannelsBoard from "./ChannelsBoard";
import SystemsBoard from "./SystemsBoard";
import { DEPARTMENTS, gateBlocks } from "@/config/workspace.config.mjs";
import { HELP, l2 } from "@/config/learn";
import Link from "next/link";
import { t, tx } from "@/lib/i18n";
import { Rec, store } from "@/lib/store";
import { fmt, saveBlob, toCsv, tone } from "@/lib/format";

export const DUE_KEYS = ["due", "deadline", "expires", "renewal", "next_service", "valid_until", "eta", "warranty_end", "publish", "session", "starts", "book_by"];
export const KIND: Record<string, { icon: string; c: string }> = {
  Presentation: { icon: "file", c: "#F26B1D" }, Brochure: { icon: "book", c: "#8B5CF6" }, Document: { icon: "file", c: "#2F7DF6" },
  Video: { icon: "video", c: "#E5484D" }, Image: { icon: "image", c: "#12A06B" }, Logo: { icon: "badge", c: "#C9971C" }, Link: { icon: "link", c: "#0EA5E9" },
  "One-pager": { icon: "file", c: "#E0458B" }, "Public datasheet": { icon: "layers", c: "#2F7DF6" }, "Case study": { icon: "book", c: "#0FA3A3" },
};
const days = (d: string) => Math.round((new Date(d).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);

export default function SectionView({ section }: { section: any }) {
  const { lang, access, toast, openAi, openMail, tick, openIntake, me, people } = useApp();
  const [rows, setRows] = useState<Rec[] | null>(null);
  const [q, setQ] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") || "" : ""));
  const [st, setSt] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("st") || "" : ""));
  const [view, setView] = useState<"table" | "board" | "gallery">(section.view === "gallery" ? "gallery" : section.board ? "board" : "table");
  const [open, setOpen] = useState<Rec | "new" | null>(null);
  const [dragOver, setDragOver] = useState("");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Selected rows for actions on many records at once
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ status?: string; who?: string; date?: string; del?: boolean }>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  // Saved views: name + search + status + sort, kept in the profile (all devices)
  const [views, setViews] = useState<{ name: string; q: string; st: string; sort?: string }[]>(() => (me?.prefs?.views?.[section.id] || []));
  const [naming, setNaming] = useState<string | null>(null);
  const canWrite = access.write.has(section.id);
  const fieldsByKey = useMemo(() => Object.fromEntries(section.fields.map((f: any) => [f.key, f])), [section]);
  const dept = DEPARTMENTS.find((d: any) => d.key === section.dept);
  const moneyKey = section.columns.find((k: string) => fieldsByKey[k]?.type === "money");

  const load = async () => { try { setRows(await store.list(section.id)); } catch (e: any) { toast(e.message || "Error", true); setRows([]); } };
  useEffect(() => { if (section.view !== "mail") load(); setSel(new Set()); }, [section.id, tick]); // eslint-disable-line
  useEffect(() => { setViews(me?.prefs?.views?.[section.id] || []); const so = new URLSearchParams(window.location.search).get("sort"); if (so) { const [k, d] = so.split(":"); setSort({ k, dir: d === "-1" ? -1 : 1 }); } }, [section.id]); // eslint-disable-line
  useEffect(() => { // deep link ?r=<id>
    if (!rows) return; const id = new URLSearchParams(window.location.search).get("r");
    if (id) { const r = rows.find((x) => x.id === id); if (r) setOpen(r); }
    else if (new URLSearchParams(window.location.search).get("new") === "1" && canWrite) setOpen("new");
  }, [rows]);
  useEffect(() => { // gallery thumbnails = first image attached to each record
    if (view !== "gallery" || !rows) return;
    let off = false;
    (async () => { const out: Record<string, string> = {}; for (const r of rows.slice(0, 60)) { const u = await store.firstImage(`${section.id}/${r.id}`); if (u) out[r.id] = u; } if (!off) setThumbs(out); })();
    return () => { off = true; };
  }, [view, rows, section.id]);

  if (section.view === "mail") return <div style={{ ["--dc" as any]: section.color, display: "grid", gap: 16 }}><MailCenter /></div>;

  const filtered = (rows || []).filter((r) => (!st || r.status === st) && (!q || (r.title + " " + JSON.stringify(r.data)).toLowerCase().includes(q.toLowerCase())));
  if (sort) filtered.sort((a, b) => {
    const va = sort.k === "title" ? a.title : sort.k === "status" ? a.status || "" : sort.k === "updated" ? a.updated_at || "" : a.data?.[sort.k] ?? "";
    const vb = sort.k === "title" ? b.title : sort.k === "status" ? b.status || "" : sort.k === "updated" ? b.updated_at || "" : b.data?.[sort.k] ?? "";
    return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sort.dir;
  });
  const th = (k: string, label: string) => <th key={k}><button onClick={() => setSort((s) => (s?.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: 1 }))}>{label}<Icon n="sort" /></button></th>;

  const moveTo = async (r: Rec, status: string) => {
    if (!canWrite || r.status === status) return;
    const g = section.gate;
    if (gateBlocks(g, status, r.data)) { toast(tx(g.msg, lang), true); return; }
    try { await store.save({ ...r, status }); toast(t("saved", lang)); load(); } catch (e: any) { toast(e.message || "Error", true); }
  };

  const cell = (r: Rec, key: string) => {
    const f = fieldsByKey[key]; const v = r.data?.[key];
    if (f?.type === "select" && v) return <span className={`chip ${tone(v)}`}>{v}</span>;
    if (f?.type === "url" && v) return <a href={v} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}><Icon n="ext" className="lockico" /></a>;
    return <span className={f?.type === "money" || f?.type === "number" ? "mono" : ""}>{fmt(f, v, lang)}</span>;
  };
  const dueCls = (r: Rec, key: string) => {
    if (!DUE_KEYS.includes(key) || !r.data?.[key]) return "";
    if (/(done|paid|closed|resolved|installed|signed|filed|delivered|received|cancelled|passed|approved|granted|retired)/i.test(r.status || "")) return "";
    const d = days(r.data[key]); return d < 0 ? "due-over" : d <= 14 ? "due-soon" : "";
  };

  const ownerKey = PEOPLE_KEYS.find((k) => fieldsByKey[k]);
  const dateKey = DUE_KEYS.find((k) => fieldsByKey[k]?.type === "date");
  const chosen = filtered.filter((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = filtered.length > 0 && filtered.every((r) => sel.has(r.id));
  const applyBulk = async () => {
    if (!chosen.length) return; setBulkBusy(true); let ok = 0, blocked = 0;
    try {
      for (const r of chosen) {
        if (bulk.del) { await store.remove(r.id); ok++; continue; }
        const status = bulk.status || r.status; const data = { ...r.data };
        if (bulk.who !== undefined && bulk.who !== "" && ownerKey) data[ownerKey] = bulk.who;
        if (bulk.date && dateKey) data[dateKey] = bulk.date;
        if (status !== r.status && gateBlocks(section.gate, status, data)) { blocked++; continue; }
        await store.save({ ...r, status, data }); ok++;
      }
      toast(`${tx({ en: "Done", ru: "Готово", uk: "Готово", ar: "تم" }, lang)}: ${ok}${blocked ? ` · ${tx({ en: "not changed (a check is missing)", ru: "не изменено (не пройдена проверка)", uk: "не змінено (не пройдено перевірку)", ar: "لم يتغير (فحص ناقص)" }, lang)}: ${blocked}` : ""}`, !!blocked && !ok);
      setBulk({}); setSel(new Set()); load();
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBulkBusy(false); }
  };
  const viewLink = (v: { q: string; st: string; sort?: string }) => `${location.origin}/${section.id.replace(".", "/")}?${new URLSearchParams({ ...(v.q ? { q: v.q } : {}), ...(v.st ? { st: v.st } : {}), ...(v.sort ? { sort: v.sort } : {}) })}`;
  const saveViews = async (list: typeof views) => {
    setViews(list); const prefs = { ...(me?.prefs || {}), views: { ...(me?.prefs?.views || {}), [section.id]: list } };
    if (me) me.prefs = prefs; try { await store.updateProfile(me.id, { prefs }); } catch (e: any) { toast(e.message || "Error", true); }
  };
  const curSort = sort ? `${sort.k}:${sort.dir}` : "";
  const counts = section.statuses.map((s: string) => ({ s, n: (rows || []).filter((r) => r.status === s).length }));
  const sum = moneyKey ? filtered.reduce((a, r) => a + (Number(r.data?.[moneyKey]) || 0), 0) : 0;

  return (
    <div style={{ ["--dc" as any]: section.color, display: "grid", gap: 16 }}>
      <section className="sec-hero">
        <span className="ic"><Icon n={section.icon} /></span>
        <div style={{ minWidth: 0, position: "relative", zIndex: 1 }}>
          <div className="eyebrow" style={{ color: section.color }}>{tx(dept?.label, lang)}</div>
          <h2>{tx(section.label, lang)}</h2>
          <div className="sub">{rows ? <><b className="mono">{rows.length}</b> {t("records", lang)}{moneyKey && sum ? <> · {t("total", lang)} <b className="mono">{fmt({ type: "money" }, sum, lang)}</b></> : null}</> : "…"}{section.controlled && <> · <Icon n="lock" className="lockico" /> {t("controlled_short", lang)}</>}</div>
          {HELP[section.id] && <div className="sec-desc">{l2(HELP[section.id], lang).split("\n")[0]} <Link href={`/learn?s=${section.id}`} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{t("how_to", lang)}</Link></div>}
        </div>
        <div className="stats">
          {counts.filter((c: any) => c.n || section.statuses.length <= 5).slice(0, 6).map((c: any) => (
            <button key={c.s} className={`stat ${st === c.s ? "on" : ""}`} onClick={() => setSt(st === c.s ? "" : c.s)}><b className={tone(c.s).replace("c-", "t-")} style={{ color: `var(--${(tone(c.s) || "c-ink").slice(2)}, var(--ink))` }}>{c.n}</b><small>{c.s}</small></button>))}
        </div>
      </section>

      {section.view === "desks" && <LegalHub />}
      {section.id === "marketing.brand" && <BrandLogos />}
      {section.id === "marketing.channels" && <ChannelsBoard />}
      {section.id === "technical.systems" && <SystemsBoard />}
      {canWrite && <SectionTemplates sectionId={section.id} />}
      <div className="toolbar">
        {canWrite && <button className="btn primary" onClick={() => setOpen("new")}><Icon n="plus" />{t("new", lang)}</button>}
        <div className="seg" role="group">
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}><Icon n="list" /> {t("table", lang)}</button>
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}><Icon n="cols" /> {t("board", lang)}</button>
          {section.view === "gallery" && <button className={view === "gallery" ? "on" : ""} onClick={() => setView("gallery")}><Icon n="grid" /> {t("gallery", lang)}</button>}
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => openMail({ section: section.id })}><Icon n="mail" />{t("write_email", lang)}</button>
        <button className="btn ghost sm" onClick={() => openAi({ title: tx(section.label, lang), section: section.id, rows: filtered.slice(0, 60) })}><Icon n="spark" />{t("ask_ai", lang)}</button>
        <button className="btn ghost sm" onClick={() => saveBlob(`AGRON_${section.id}_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(section, filtered, lang), "text/csv;charset=utf-8")}><Icon n="download" />{t("export_csv", lang)}</button>
        {canWrite && section.view !== "desks" && <CsvImport section={section} onDone={load} />}
      </div>

      <section className="card">
        <div className="filters">
          <div className="search"><Icon n="search" /><input className="input" type="search" placeholder={t("search", lang)} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search", lang)} /></div>
          <select className="input" value={st} onChange={(e) => setSt(e.target.value)} aria-label={t("all_status", lang)}>
            <option value="">{t("all_status", lang)}</option>{section.statuses.map((s: string) => <option key={s}>{s}</option>)}
          </select>
          <div className="views">
            {views.map((v) => <span key={v.name} className={`chip view-chip ${v.q === q && v.st === st && (v.sort || "") === curSort ? "on" : ""}`}>
              <button onClick={() => { setQ(v.q); setSt(v.st); if (v.sort) { const [k, d] = v.sort.split(":"); setSort({ k, dir: d === "-1" ? -1 : 1 }); } else setSort(null); }}>{v.name}</button>
              <button aria-label={tx({ en: "Copy link", ru: "Скопировать ссылку", uk: "Скопіювати посилання", ar: "نسخ الرابط" }, lang)} title={tx({ en: "Copy link to share", ru: "Скопировать ссылку для коллеги", uk: "Скопіювати посилання для колеги", ar: "نسخ رابط لمشاركته" }, lang)} onClick={() => navigator.clipboard?.writeText(viewLink(v)).then(() => toast(t("copied", lang))).catch(() => {})}><Icon n="link" /></button>
              <button aria-label={t("delete", lang)} onClick={() => saveViews(views.filter((x) => x.name !== v.name))}><Icon n="x" /></button></span>)}
            {(q || st || sort) && (naming === null
              ? <button className="btn ghost sm" onClick={() => setNaming("")}><Icon n="plus" />{tx({ en: "Save view", ru: "Сохранить вид", uk: "Зберегти вигляд", ar: "حفظ العرض" }, lang)}</button>
              : <form className="toolbar" style={{ flexWrap: "nowrap", gap: 6 }} onSubmit={(e) => { e.preventDefault(); const n = (naming || "").trim(); if (n) { saveViews([...views.filter((x) => x.name !== n), { name: n, q, st, sort: curSort || undefined }]); setNaming(null); } }}>
                  <input className="input" autoFocus style={{ width: 170 }} value={naming} placeholder={tx({ en: "View name", ru: "Название вида", uk: "Назва вигляду", ar: "اسم العرض" }, lang)} onChange={(e) => setNaming(e.target.value)} />
                  <button className="btn primary sm" type="submit">{t("save", lang)}</button><button className="btn ghost sm" type="button" onClick={() => setNaming(null)}>{t("cancel", lang)}</button></form>)}
          </div>
        </div>

        {view === "table" && chosen.length > 0 && <div className="bulkbar" role="region" aria-label="bulk">
          <b>{tx({ en: "Selected", ru: "Выбрано", uk: "Вибрано", ar: "المحدد" }, lang)}: {chosen.length}</b>
          {canWrite && !bulk.del && <>
            <select className="input" value={bulk.status || ""} onChange={(e) => setBulk({ ...bulk, status: e.target.value || undefined })} aria-label={t("status", lang)}><option value="">{t("status", lang)} —</option>{section.statuses.map((s: string) => <option key={s}>{s}</option>)}</select>
            {ownerKey && <input className="input" list="people-bulk" style={{ width: 170 }} value={bulk.who || ""} placeholder={tx(fieldsByKey[ownerKey].label, lang)} onChange={(e) => setBulk({ ...bulk, who: e.target.value })} />}
            <datalist id="people-bulk">{people.map((p) => <option key={p.id} value={p.full_name || p.email} />)}</datalist>
            {dateKey && <input className="input" type="date" style={{ width: 160 }} value={bulk.date || ""} onChange={(e) => setBulk({ ...bulk, date: e.target.value || undefined })} aria-label={tx(fieldsByKey[dateKey].label, lang)} title={tx(fieldsByKey[dateKey].label, lang)} />}
          </>}
          {bulk.del && <span className="faint">{t("confirm_delete", lang)}</span>}
          <span style={{ flex: 1 }} />
          {canWrite && (bulk.status || bulk.who || bulk.date || bulk.del) && <button className={`btn sm ${bulk.del ? "danger" : "primary"}`} disabled={bulkBusy} onClick={applyBulk}><Icon n="check" />{bulkBusy ? "…" : tx({ en: "Apply", ru: "Применить", uk: "Застосувати", ar: "تطبيق" }, lang)}</button>}
          <button className="btn ghost sm" onClick={() => saveBlob(`AGRON_${section.id}_selected.csv`, toCsv(section, chosen, lang), "text/csv;charset=utf-8")}><Icon n="download" />{t("export_csv", lang)}</button>
          {canWrite && !bulk.del && <button className="btn ghost sm danger" onClick={() => setBulk({ del: true })}><Icon n="trash" />{t("delete", lang)}</button>}
          <button className="btn ghost sm" onClick={() => { setSel(new Set()); setBulk({}); }}>{t("cancel", lang)}</button>
        </div>}
        {rows === null ? <div className="empty">…</div> : !rows.length ? (
          <div className="empty"><span className="ic" style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: 18, background: "color-mix(in srgb,var(--dc) 15%,transparent)", color: "var(--dc)", marginBottom: 10 }}><Icon n={section.icon} /></span><b>{t("empty", lang)}</b>{canWrite ? t("empty_p", lang) : ""}{canWrite && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => openIntake()}><Icon n="upload" />{t("intake_empty", lang)}</button>}</div>
        ) : view === "gallery" ? (
          <div className="gallery">{filtered.map((r) => { const k = KIND[r.data?.kind] || KIND.Document; return (
            <button key={r.id} className="gcard" onClick={() => setOpen(r)}>
              <div className="gthumb" style={{ ["--kc" as any]: k.c }}>{thumbs[r.id] ? <img src={thumbs[r.id]} alt="" /> : <Icon n={k.icon} />}{r.data?.kind && <span className="kind-chip">{r.data.kind}</span>}</div>
              <div className="gbody"><b>{r.title}</b><div className="toolbar">{r.status && <span className={`chip dot ${tone(r.status)}`}>{r.status}</span>}{r.data?.audience && <span className="chip">{r.data.audience}</span>}{r.data?.languages && <span className="chip">{r.data.languages}</span>}</div></div>
            </button>); })}</div>
        ) : view === "table" ? (
          <>
            <div className="tablewrap"><table className="tb"><thead><tr>
              <th className="col-sel"><input type="checkbox" checked={allOn} aria-label={tx({ en: "Select all", ru: "Выбрать все", uk: "Вибрати все", ar: "تحديد الكل" }, lang)} onChange={() => setSel(allOn ? new Set() : new Set(filtered.map((r) => r.id)))} /></th>
              {th("title", t("title", lang))}{th("status", t("status", lang))}
              {section.columns.map((k: string) => th(k, tx(fieldsByKey[k]?.label, lang)))}<th className="col-upd"><button onClick={() => setSort((s) => (s?.k === "updated" ? { k: "updated", dir: s.dir === 1 ? -1 : 1 } : { k: "updated", dir: -1 }))}>{t("updated", lang)}<Icon n="sort" /></button></th>
            </tr></thead><tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`row ${sel.has(r.id) ? "picked" : ""}`} tabIndex={0} onClick={() => setOpen(r)} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                  <td className="col-sel" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.title} /></td>
                  <td style={{ fontWeight: 600 }}>{r.controlled && <Icon n="lock" className="lockico" />} {r.title} {r.data?.sample && <span className="chip c-vio" style={{ marginInlineStart: 6 }}>{t("sample", lang)}</span>}</td>
                  <td>{r.status && <span className={`chip dot ${tone(r.status)}`}>{r.status}</span>}</td>
                  {section.columns.map((k: string) => <td key={k} className={dueCls(r, k)}>{cell(r, k)}</td>)}
                  <td className="faint mono col-upd" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{(r.updated_at || "").slice(0, 10)}</td>
                </tr>))}
            </tbody></table></div>
            {!filtered.length && <div className="empty">{t("no_match", lang)}</div>}
            <div className="tfoot"><span><b className="mono">{filtered.length}</b> / {rows.length} {t("records", lang)}</span>{moneyKey && sum ? <span>{t("total", lang)}: <b className="mono">{fmt({ type: "money" }, sum, lang)}</b></span> : null}</div>
          </>
        ) : (
          <div className="boardwrap"><div className="board">
            {section.statuses.map((s: string) => {
              const items = filtered.filter((r) => r.status === s);
              return (
                <div key={s} className={`col ${tone(s)} ${dragOver === s ? "drop" : ""}`} style={{ color: "inherit", background: dragOver === s ? undefined : "var(--surface-2)" }}
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
      {open && <RecordDrawer section={section} rec={open === "new" ? null : open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} onReload={load} />}
      <style>{`.lockico{width:15px;height:15px;color:var(--warn);vertical-align:-2px}`}</style>
    </div>
  );
}
