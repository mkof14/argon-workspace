"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { useApp, SECTIONS, findSection } from "./App";
import { DEPARTMENTS } from "@/config/workspace.config.mjs";
import { t, tx } from "@/lib/i18n";
import { DEMO, sb } from "@/lib/sb";
import { isOffice, officeText } from "@/lib/office";

type Item = {
  id: string; file: File; step: "upload" | "read" | "ready" | "saving" | "saved" | "error" | "unsupported";
  path?: string; text?: string; error?: string;
  section?: string; title?: string; status?: string; data?: Record<string, any>; summary?: string; reason?: string;
  controlled?: boolean; suggestControlled?: boolean; alternatives?: string[]; confidence?: number; savedId?: string; warning?: string;
};
const OK = /\.(pdf|png|jpe?g|webp|gif|txt|md|csv|tsv|json|xml|docx|xlsx|pptx)$/i;
const NOTE_KEYS = ["notes", "findings", "specs", "request", "body", "scope", "description"];
const api = (body: any) => fetch("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Smart upload: drop any document, AI proposes the section and fields, the user checks and saves. */
export default function Intake({ onClose, initial }: { onClose: () => void; initial?: File[] }) {
  const { lang, me, access, toast, reload } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const upd = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const writable = SECTIONS.filter((s) => access.write.has(s.id) && s.id !== "legal.matrix" && s.id !== "legal.desks" && !s.id.startsWith("mail."));

  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && !items.some((x) => ["upload", "read", "saving"].includes(x.step)) && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [items, onClose]);
  useEffect(() => { if (initial?.length) add(initial); }, []); // eslint-disable-line

  const process = async (it: Item) => {
    try {
      if (DEMO) throw new Error(t("ai_demo", lang));
      let text = "";
      if (isOffice(it.file.name)) text = await officeText(it.file, it.file.name);
      const s = await api({ action: "sign", name: it.file.name, size: it.file.size });
      if (!s.ok) throw new Error(await s.text());
      const { path, token } = await s.json();
      const { error } = await sb().storage.from("files").uploadToSignedUrl(path, token, it.file, { contentType: it.file.type || "application/octet-stream" });
      if (error) throw error;
      upd(it.id, { step: "read", path });
      const r = await api({ action: "analyze", path, name: it.file.name, type: it.file.type, text: text || undefined, lang });
      if (!r.ok) throw new Error(await r.text());
      const p = await r.json();
      if (p.unsupported) { upd(it.id, { step: "unsupported", path }); return; }
      upd(it.id, { step: "ready", path, ...p });
    } catch (e: any) { upd(it.id, { step: "error", error: e?.message || "Error" }); }
  };
  const add = (list: FileList | File[]) => {
    const fresh: Item[] = [...list].map((file) => ({ id: Math.random().toString(36).slice(2), file, step: OK.test(file.name) ? "upload" : "unsupported" } as Item));
    setItems((xs) => [...xs, ...fresh]);
    (async () => { for (const it of fresh) if (it.step === "upload") await process(it); })(); // one at a time keeps it fast and within limits
  };
  const save = async (it: Item) => {
    if (!it.section) return;
    upd(it.id, { step: "saving" });
    const sec = findSection(it.section);
    const data = { ...(it.data || {}) };
    const nk = NOTE_KEYS.find((k) => sec?.fields.some((f: any) => f.key === k));
    if (nk && !data[nk] && it.summary) data[nk] = it.summary;
    const r = await api({ action: "save", path: it.path, name: it.file.name, section: it.section, title: it.title, status: it.status, data, controlled: it.controlled });
    if (!r.ok) { upd(it.id, { step: "ready", error: await r.text() }); return; }
    const j = await r.json(); upd(it.id, { step: "saved", savedId: j.id, warning: j.warning, error: undefined }); reload();
  };
  const remove = async (it: Item) => { if (it.path && it.step !== "saved") api({ action: "discard", path: it.path }).catch(() => {}); setItems((xs) => xs.filter((x) => x.id !== it.id)); };
  const ready = items.filter((x) => x.step === "ready");
  const busy = items.some((x) => ["upload", "read", "saving"].includes(x.step));
  const close = () => { for (const it of items) if (it.path && !["saved"].includes(it.step)) api({ action: "discard", path: it.path }).catch(() => {}); onClose(); };

  const changeSection = (it: Item, id: string) => {
    const sec = findSection(id); const data: Record<string, any> = {};
    for (const [k, v] of Object.entries(it.data || {})) if (sec?.fields.some((f: any) => f.key === k)) data[k] = v;
    upd(it.id, { section: id, data, status: sec?.statuses.includes(it.status) ? it.status : sec?.statuses[0] });
  };
  const field = (it: Item, f: any) => {
    const v = it.data?.[f.key] ?? ""; const set = (x: any) => upd(it.id, { data: { ...(it.data || {}), [f.key]: x } }); const id = `in-${it.id}-${f.key}`;
    let ctl;
    if (f.type === "select") ctl = <select id={id} className="input" value={v} onChange={(e) => set(e.target.value)}><option value="" />{f.options.map((o: string) => <option key={o}>{o}</option>)}</select>;
    else if (f.type === "long") ctl = <textarea id={id} className="input" rows={3} value={v} onChange={(e) => set(e.target.value)} />;
    else if (f.type === "check") return <label key={f.key} className="check"><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />{tx(f.label, lang)}</label>;
    else ctl = <input id={id} className="input" type={f.type === "date" ? "date" : f.type === "money" || f.type === "number" ? "number" : "text"} value={v} onChange={(e) => set(f.type === "money" || f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />;
    return <div key={f.key} className={`field ${f.type === "long" ? "wide" : ""}`}><label htmlFor={id}>{tx(f.label, lang)}</label>{ctl}</div>;
  };
  const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={t("intake_t", lang)}>
      <div className="scrim" onClick={() => !busy && close()} />
      <div className="modal card intake">
        <div className="card-h toolbar"><h2><Icon n="upload" />{t("intake_t", lang)}</h2>
          <button className="iconbtn" style={{ marginInlineStart: "auto" }} onClick={close} disabled={busy} aria-label={t("close", lang)}>×</button></div>
        <div className="card-b" style={{ display: "grid", gap: 14 }}>
          <ol className="intake-steps">
            <li><b>1</b><span>{t("intake_s1", lang)}</span></li>
            <li><b>2</b><span>{t("intake_s2", lang)}</span></li>
            <li><b>3</b><span>{t("intake_s3", lang)}</span></li>
          </ol>
          <div className={`dropzone intake-drop ${over ? "on" : ""}`} role="button" tabIndex={0} onClick={() => inp.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inp.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
            <Icon n="upload" /><b>{t("intake_drop", lang)}</b><span className="faint">{t("intake_types", lang)}</span>
            <input ref={inp} type="file" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
          </div>

          {items.map((it) => { const sec = it.section ? findSection(it.section) : null; return (
            <section key={it.id} className={`intake-card s-${it.step}`}>
              <div className="intake-file"><Icon n="file" /><b title={it.file.name}>{it.file.name}</b><span className="faint">{kb(it.file.size)}</span>
                <span className="intake-state">{
                  it.step === "upload" ? <><span className="spin" />{t("intake_uploading", lang)}</> :
                  it.step === "read" ? <><span className="spin" />{t("intake_reading", lang)}</> :
                  it.step === "saving" ? <><span className="spin" />{t("saving", lang)}</> :
                  it.step === "saved" ? <span className="chip c-ok">{t("intake_saved", lang)}</span> :
                  it.step === "error" ? <span className="chip c-bad">{t("intake_failed", lang)}</span> :
                  it.step === "unsupported" ? <span className="chip c-warn">{t("intake_unsupported", lang)}</span> : <span className="chip c-info">{t("intake_check", lang)}</span>}</span>
                {it.step !== "saving" && it.step !== "saved" && <button className="linkbtn" onClick={() => remove(it)}>{t("intake_remove", lang)}</button>}
              </div>
              {it.step === "error" && <p className="intake-err">{it.error}</p>}
              {it.step === "unsupported" && <p className="faint" style={{ margin: 0 }}>{t("intake_unsupported_p", lang)}</p>}
              {it.step === "saved" && sec && <p style={{ margin: 0 }}>{t("saved_to", lang).replace("{s}", `${tx((DEPARTMENTS as any[]).find((d) => d.key === sec.dept)?.label, lang)} → ${tx(sec.label, lang)}`)} · <Link href={`/${sec.dept}/${sec.key}?r=${it.savedId}`} onClick={onClose}>{t("open", lang)}</Link>{it.warning ? <span className="intake-err"> {it.warning}</span> : null}</p>}
              {(it.step === "ready" || it.step === "saving") && sec && <>
                {it.reason && <p className="intake-why"><Icon n="spark" />{it.reason}</p>}
                <div className="intake-grid">
                  <div className="field"><label>{t("intake_where", lang)}</label>
                    <select className="input" value={it.section} onChange={(e) => changeSection(it, e.target.value)}>
                      {(DEPARTMENTS as any[]).map((d) => { const ss = writable.filter((s) => s.dept === d.key); return ss.length ? <optgroup key={d.key} label={tx(d.label, lang)}>{ss.map((s) => <option key={s.id} value={s.id}>{tx(s.label, lang)}</option>)}</optgroup> : null; })}
                    </select>
                    {!!it.alternatives?.length && <span className="intake-alt">{t("intake_or", lang)} {it.alternatives.map((a) => <button key={a} className="linkbtn" onClick={() => changeSection(it, a)}>{tx(findSection(a)?.label, lang)}</button>)}</span>}
                  </div>
                  <div className="field"><label>{t("status", lang)}</label><select className="input" value={it.status} onChange={(e) => upd(it.id, { status: e.target.value })}>{sec.statuses.map((s: string) => <option key={s}>{s}</option>)}</select></div>
                  <div className="field wide"><label>{t("title", lang)}</label><input className="input" value={it.title || ""} onChange={(e) => upd(it.id, { title: e.target.value })} /></div>
                  {it.summary && <div className="field wide"><label>{t("intake_summary", lang)}</label><textarea className="input" rows={3} value={it.summary} onChange={(e) => upd(it.id, { summary: e.target.value })} /></div>}
                </div>
                <details className="intake-more" open={Object.keys(it.data || {}).length > 0 && Object.keys(it.data || {}).length <= 6}>
                  <summary>{t("intake_fields", lang)} <span className="faint">({Object.keys(it.data || {}).length}/{sec.fields.filter((f: any) => !["html", "checklist"].includes(f.type)).length})</span></summary>
                  <div className="intake-grid">{sec.fields.filter((f: any) => !["html", "checklist"].includes(f.type) && !NOTE_KEYS.includes(f.key)).map((f: any) => field(it, f))}</div>
                </details>
                {me.us_person ? <label className="check intake-ctl"><input type="checkbox" checked={!!it.controlled} onChange={(e) => upd(it.id, { controlled: e.target.checked })} /><span><b>{t("intake_controlled", lang)}</b> {it.suggestControlled ? <span className="chip c-warn">{t("intake_ai_suggests", lang)}</span> : null}<br /><span className="faint">{t("intake_controlled_p", lang)}</span></span></label>
                  : it.suggestControlled ? <p className="intake-err">{t("intake_controlled_nonus", lang)}</p> : null}
                {it.error && <p className="intake-err">{it.error}</p>}
                <div className="toolbar"><button className="btn primary sm" disabled={it.step === "saving"} onClick={() => save(it)}><Icon n="check" />{t("intake_save", lang)}</button></div>
              </>}
            </section>); })}
        </div>
        {items.length > 0 && <div className="card-h toolbar intake-foot">
          <span className="faint">{t("intake_count", lang).replace("{s}", String(items.filter((x) => x.step === "saved").length)).replace("{n}", String(items.length))}</span>
          {ready.length > 1 && <button className="btn primary sm" style={{ marginInlineStart: "auto" }} onClick={async () => { for (const it of ready) await save(it); toast(t("intake_all_saved", lang)); }}><Icon n="check" />{t("intake_save_all", lang).replace("{n}", String(ready.length))}</button>}
          {!busy && !ready.length && <button className="btn sm" style={{ marginInlineStart: "auto" }} onClick={close}>{t("intake_done", lang)}</button>}
        </div>}
      </div>
    </div>
  );
}
