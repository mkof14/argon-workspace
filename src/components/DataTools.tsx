"use client";
import { useRef, useState } from "react";
import Icon from "./Icon";
import { useApp, SECTIONS } from "./App";
import { t, tx } from "@/lib/i18n";
import { store } from "@/lib/store";
import { saveBlob } from "@/lib/format";

/** Minimal RFC-4180 CSV parser (quotes, commas, semicolons, new lines in quotes). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, ""); const delim = (s.split("\n")[0].match(/;/g)?.length || 0) > (s.split("\n")[0].match(/,/g)?.length || 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === delim) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Import a CSV (e.g. from Excel or Google Sheets) into one section. Columns are matched by field name in any language. */
export function CsvImport({ section, onDone }: { section: any; onDone: () => void }) {
  const { lang, toast } = useApp();
  const inp = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<null | { rows: Record<string, any>[]; map: string[]; skipped: string[] }>(null);
  const [busy, setBusy] = useState(false);

  const read = async (f: File) => {
    const rows = parseCsv(await f.text()); if (rows.length < 2) { toast(t("csv_empty", lang), true); return; }
    const head = rows[0];
    const keyFor = (h: string) => {
      const n = norm(h);
      if (["title", "name", "название", "назва", "имя", "العنوان"].includes(n)) return "title";
      if (["status", "статус", "الحالة"].includes(n)) return "status";
      const f = section.fields.find((x: any) => norm(x.key) === n || Object.values(x.label || {}).some((l: any) => norm(String(l)) === n));
      return f ? f.key : "";
    };
    const keys = head.map(keyFor);
    if (!keys.includes("title")) { toast(t("csv_need_title", lang), true); return; }
    const out = rows.slice(1).map((r) => {
      const o: Record<string, any> = { data: {} };
      keys.forEach((k, i) => {
        const v = (r[i] ?? "").trim(); if (!k || !v) return;
        if (k === "title" || k === "status") { o[k] = v; return; }
        const f = section.fields.find((x: any) => x.key === k);
        o.data[k] = f?.type === "number" || f?.type === "money" ? Number(v.replace(/[^\d.\-]/g, "")) || v : f?.type === "check" ? /^(1|true|yes|да|x|✓)$/i.test(v) : f?.type === "date" && !isNaN(Date.parse(v)) ? new Date(v).toISOString().slice(0, 10) : v;
      });
      if (!section.statuses.includes(o.status)) o.status = section.statuses[0];
      return o;
    }).filter((o) => o.title);
    setPlan({ rows: out, map: head.map((h, i) => keys[i] ? `${h} → ${keys[i] === "title" ? t("title", lang) : keys[i] === "status" ? t("status", lang) : tx(section.fields.find((x: any) => x.key === keys[i])?.label, lang)}` : "").filter(Boolean), skipped: head.filter((_, i) => !keys[i]) });
  };
  const run = async () => {
    if (!plan) return; setBusy(true); let ok = 0;
    try { for (const r of plan.rows) { await store.save({ section: section.id, title: String(r.title).slice(0, 200), status: r.status, data: r.data }); ok++; } toast(t("csv_done", lang).replace("{n}", String(ok))); setPlan(null); onDone(); }
    catch (e: any) { toast(`${ok} ✓ · ${e.message || "Error"}`, true); } finally { setBusy(false); }
  };
  const template = () => {
    const head = ["Title", "Status", ...section.fields.filter((f: any) => !["html", "checklist"].includes(f.type)).map((f: any) => tx(f.label, "en"))];
    saveBlob(`AGRON_${section.id}_import_template.csv`, "﻿" + head.map((h) => `"${h}"`).join(",") + "\r\n", "text/csv");
  };
  return <>
    <input ref={inp} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
    <button className="btn ghost sm" onClick={() => inp.current?.click()}><Icon n="upload" />{t("csv_import", lang)}</button>
    {plan && <div className="modal-wrap" role="dialog" aria-modal="true"><div className="scrim" onClick={() => setPlan(null)} />
      <div className="modal card"><div className="card-h"><h2><Icon n="upload" />{t("csv_import", lang)} · {tx(section.label, lang)}</h2></div>
        <div className="card-b" style={{ display: "grid", gap: 10 }}>
          <p style={{ margin: 0 }}><b>{plan.rows.length}</b> {t("csv_rows", lang)}</p>
          <div><b>{t("csv_matched", lang)}:</b><div className="chips" style={{ marginTop: 6 }}>{plan.map.map((m) => <span key={m} className="chip c-ok">{m}</span>)}</div></div>
          {plan.skipped.length > 0 && <div><b>{t("csv_skipped", lang)}:</b> <span className="faint">{plan.skipped.join(", ")}</span></div>}
          <div className="toolbar"><button className="btn primary" disabled={busy || !plan.rows.length} onClick={run}>{busy ? "…" : t("csv_go", lang).replace("{n}", String(plan.rows.length))}</button>
            <button className="btn ghost" onClick={() => setPlan(null)}>{t("cancel", lang)}</button>
            <button className="linkbtn" onClick={template}>{t("csv_template", lang)}</button></div>
        </div></div></div>}
  </>;
}

/** Owner-only full export: every record, comment and profile the owner can see, as JSON (backup) and CSV per section. */
export function FullExport() {
  const { lang, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const go = async (kind: "json" | "csv") => {
    setBusy(true);
    try {
      const recs = await store.listMany(SECTIONS.map((s) => s.id));
      const day = new Date().toISOString().slice(0, 10);
      if (kind === "json") {
        const profiles = await store.profiles();
        saveBlob(`AGRON_Workspace_backup_${day}.json`, JSON.stringify({ exported_at: new Date().toISOString(), version: 1, records: recs, profiles }, null, 1), "application/json");
      } else {
        const lines = ["﻿Section,Title,Status,Updated,Data"];
        for (const r of recs) lines.push([r.section, r.title, r.status || "", r.updated_at || "", JSON.stringify(r.data)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
        saveBlob(`AGRON_Workspace_all_records_${day}.csv`, lines.join("\r\n"), "text/csv");
      }
      toast(t("export_done", lang).replace("{n}", String(recs.length)));
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  return <section className="card"><div className="card-h"><h2><Icon n="download" />{t("backup_t", lang)}</h2></div>
    <div className="card-b" style={{ display: "grid", gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>{t("backup_p", lang)}</p>
      <div className="toolbar"><button className="btn primary sm" disabled={busy} onClick={() => go("json")}><Icon n="download" />{t("backup_json", lang)}</button>
        <button className="btn sm" disabled={busy} onClick={() => go("csv")}><Icon n="download" />{t("backup_csv", lang)}</button></div>
    </div></section>;
}
