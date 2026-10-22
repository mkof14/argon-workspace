"use client";
// Phase 8 — small shared pieces of the manufacturing screens: words, errors, a confirmation step for every write,
// tables, status chips and the printable label (QR made in the browser, no outside service).
import { useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { say } from "@/lib/opsText";
import { L, STATUS_T, W, type T4 } from "@/lib/mfgText";
import { qrSvg } from "@/lib/qr";

export const useT = () => { const { lang } = useApp(); return (x: T4 | string, v?: any) => (typeof x === "string" ? x : say(x, lang, v)); };
export const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");
export const when = (s?: string | null) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");
export const Err = ({ e }: { e: string }) => (e ? <div className="card" role="alert" data-err style={{ padding: 12, borderColor: "var(--bad, #c33)" }}><small className="neg">{e}</small></div> : null);
export const Wait = () => <div className="card empty" aria-busy="true">…</div>;

export function StatusChip({ s }: { s?: string | null }) {
  const T = useT(); if (!s) return null;
  const bad = /(Hold|Fail|Blocked|Rejected|Open|Rework)/.test(s); const good = /(Shipped|Delivered|Accepted|Approved|Pass|Completed|Closed|Ready)/.test(s);
  return <span className="chip" data-status={s} style={{ borderColor: bad ? "var(--bad, #c33)" : good ? "var(--ok, #1a7f4b)" : undefined }}>{STATUS_T[s] ? T(STATUS_T[s]) : s}</span>;
}

/** Reasons from readiness / blockers: always the database's own sentences. */
export function Reasons({ list }: { list?: any[] }) {
  if (!list?.length) return <small className="faint">—</small>;
  return <ul style={{ margin: 0, paddingInlineStart: 18 }} data-reasons>{list.map((r: any, i) => <li key={i} data-kind={r.kind} className={r.level === "block" ? "neg" : ""} style={{ overflowWrap: "anywhere" }}>{typeof r === "string" ? r : r.text}</li>)}</ul>;
}

export function Tbl({ cols, rows, empty }: { cols: [string, T4 | string, ((r: any) => any)?][]; rows?: any[] | null; empty?: T4 }) {
  const T = useT();
  if (!rows) return <div className="empty">…</div>;
  if (!rows.length) return <div className="empty" style={{ padding: 12 }}>{T(empty || W.none)}</div>;
  return <div style={{ overflowX: "auto", maxWidth: "100%" }}><table className="tbl"><thead><tr>{cols.map(([k, l]) => <th key={k}>{T(l)}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={r.id || i} data-row={r.id || i}>{cols.map(([k, , f]) => <td key={k} style={{ overflowWrap: "anywhere" }}>{f ? f(r) : r[k] == null ? "—" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])}</td>)}</tr>)}</tbody></table></div>;
}

/**
 * Every write passes through here: what will happen is said in words, a reason can be required, and nothing is sent
 * until the person presses Confirm. The database checks the authority again.
 */
export function Act({ label, icon, what, reason, run, done, disabled, danger, data }: {
  label: T4; icon?: string; what: T4 | string; reason?: "required" | "optional"; run: (reason: string) => Promise<any>; done?: (r: any) => void; disabled?: boolean; danger?: boolean; data?: string;
}) {
  const T = useT(); const { toast } = useApp();
  const [open, setOpen] = useState(false); const [why, setWhy] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const go = async () => { setBusy(true); setErr(""); try { const r = await run(why.trim()); setOpen(false); setWhy(""); toast(T(L("Done", "Готово", "Готово", "تم"))); done?.(r); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  if (!open) return <button className={`btn sm ${danger ? "ghost" : ""}`} data-act={data || label.en} disabled={disabled} onClick={() => setOpen(true)}>{icon && <Icon n={icon} />}{T(label)}</button>;
  return <div className="card" data-confirm={data || label.en} style={{ padding: 12, display: "grid", gap: 8, minWidth: 0 }}>
    <b>{T(label)}</b><small style={{ overflowWrap: "anywhere" }}>{T(what)}</small>
    {reason && <label className="fld"><span>{T(W.reason)}{reason === "required" ? " *" : ""}</span><textarea rows={2} data-reason value={why} onChange={(e) => setWhy(e.target.value)} /></label>}
    <small className="faint">{T(W.confirmNote)}</small>
    {err && <small className="neg" role="alert" data-err>{err}</small>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn sm" data-confirm-go disabled={busy || (reason === "required" && why.trim().length < 3)} onClick={go}><Icon n="check" />{T(W.confirm)}</button>
      <button className="btn ghost sm" onClick={() => { setOpen(false); setErr(""); }}>{T(W.cancel)}</button></div>
  </div>;
}

/** The printable label: big number, two lines, the QR code (AGR1:kind:id — it opens only for people who may see the record). */
export function LabelCard({ l }: { l: any }) {
  if (!l) return null; let svg = ""; try { svg = qrSvg(l.qr, 3); } catch {}
  return <div className="mfg-label" data-label={l.kind} style={{ border: "1px solid #000", background: "#fff", color: "#000", padding: 10, display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: 10, alignItems: "center", width: "min(100%, 360px)", breakInside: "avoid" }}>
    <span dangerouslySetInnerHTML={{ __html: svg }} data-qr={l.qr} />
    <span style={{ minWidth: 0 }}><b style={{ fontSize: 18, overflowWrap: "anywhere", fontFamily: "monospace" }}>{l.big}</b><br />
      {(l.lines || []).filter(Boolean).map((x: string, i: number) => <small key={i} style={{ display: "block", overflowWrap: "anywhere" }}>{x}</small>)}
      <small style={{ fontSize: 9 }}>{l.footer}</small></span>
  </div>;
}

export function printLabels(labels: any[]) {
  const w = window.open("", "_blank"); if (!w) return;
  const html = labels.map((l) => { let s = ""; try { s = qrSvg(l.qr, 3); } catch {}
    const esc = (x: any) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    return `<div class="l">${s}<div><b>${esc(l.big)}</b>${(l.lines || []).filter(Boolean).map((x: string) => `<small>${esc(x)}</small>`).join("")}<i>${esc(l.footer)}</i></div></div>`; }).join("");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Labels</title><style>body{font-family:system-ui,sans-serif;margin:8mm}.l{display:inline-grid;grid-template-columns:auto 1fr;gap:3mm;align-items:center;border:1px solid #000;padding:3mm;margin:2mm;width:85mm;break-inside:avoid}.l b{font:700 14pt monospace;display:block}.l small{display:block;font-size:8pt}.l i{font-size:6pt}</style>${html}<script>onload=()=>print()</script>`);
  w.document.close();
}
