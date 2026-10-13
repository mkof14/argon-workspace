"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { t } from "@/lib/i18n";
import { DEMO, FileItem, Rec, store } from "@/lib/store";

const MAX = 50 * 1024 * 1024;
export const fileIcon = (type: string, name = "") =>
  type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : /pdf/.test(type) || /\.pdf$/i.test(name) ? "pdf" : /presentation|powerpoint|\.pptx?$|\.key$/i.test(type + name) ? "file" : "clip";
export const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Viewer({ file, url, onClose }: { file: FileItem; url: string; onClose: () => void }) {
  const { lang } = useApp();
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <div className="scrim" style={{ zIndex: 74 }} onClick={onClose} />
      <div className="viewer" role="dialog" aria-modal="true" aria-label={file.name}>
        <div className="drawer-h" style={{ alignItems: "center" }}><b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</b>
          <a className="btn sm" href={url} target="_blank" rel="noopener"><Icon n="ext" />{t("open", lang)}</a>
          <button className="iconbtn" onClick={onClose} aria-label={t("close", lang)}><Icon n="x" /></button></div>
        <div className="vb">
          {file.type.startsWith("image/") ? <img src={url} alt={file.name} /> : file.type.startsWith("video/") ? <video src={url} controls autoPlay /> : <iframe title={file.name} src={url} />}
        </div>
      </div>
    </>
  );
}

export default function Attachments({ section, rec, canWrite, title }: { section: any; rec: Rec | null; canWrite: boolean; title: string }) {
  const { lang, toast, openMail } = useApp();
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [view, setView] = useState<{ f: FileItem; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const prefix = rec ? `${section.id}/${rec.id}` : "";

  const load = () => { if (prefix) store.files(prefix).then(setFiles).catch(() => setFiles([])); };
  useEffect(load, [prefix]); // eslint-disable-line

  const upload = async (list: FileList | null) => {
    if (!list?.length || !prefix) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) {
        if (f.size > MAX) { toast(t("file_too_big", lang), true); continue; }
        const it = await store.upload(prefix, f);
        if (!DEMO && /\.(pdf|docx|xlsx|pptx|txt|md|csv)$/i.test(f.name)) fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "index", path: it.path }) }).catch(() => {}); // searchable in Ask your documents
      }
      toast(t("uploaded", lang)); load();
    } catch (e: any) { toast(e.message || "Upload failed", true); } finally { setBusy(false); }
  };
  const logFile = (f: FileItem) => { if (rec?.controlled && !DEMO) fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record_id: rec.id, file: f.name }) }).catch(() => {}); };
  const open = async (f: FileItem) => { logFile(f); try { setView({ f, url: await store.fileUrl(f.path) }); } catch (e: any) { toast(e.message, true); } };
  const dl = async (f: FileItem) => { logFile(f); try { const u = await store.fileUrl(f.path, 600, f.name); const a = document.createElement("a"); a.href = u; a.download = f.name; a.click(); } catch (e: any) { toast(e.message, true); } };
  const share = async (f: FileItem) => { try { const u = await store.fileUrl(f.path, 7 * 86400); await navigator.clipboard.writeText(u); toast(t("link_copied", lang)); } catch (e: any) { toast(e.message, true); } };
  const mail = async (list: FileItem[]) => {
    try {
      const links = await Promise.all(list.map(async (f) => `- ${f.name}: ${await store.fileUrl(f.path, 7 * 86400)}`));
      openMail({ template: "materials", section: section.id, record: rec || undefined, vars: { material: title, links: links.join("\n") } });
    } catch (e: any) { toast(e.message, true); }
  };
  const del = async (f: FileItem) => { try { await store.removeFile(f.path); if (!DEMO) fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", path: f.path }) }).catch(() => {}); load(); } catch (e: any) { toast(e.message, true); } };

  return (
    <div className="thread">
      <div className="toolbar"><div className="eyebrow" style={{ flex: 1 }}><Icon n="clip" className="lockico" /> {t("attachments", lang)} {files?.length ? `· ${files.length}` : ""}</div>
        {!!files?.length && <button className="btn ghost sm" onClick={() => mail(files)}><Icon n="send" />{t("email_btn", lang)}</button>}</div>
      {!rec ? <div className="faint" style={{ fontSize: 14 }}>{t("save_first", lang)}</div> : (
        <div className="att">
          {files?.map((f) => (
            <div key={f.path} className="att-row">
              <Icon n={fileIcon(f.type, f.name)} />
              <button className="nm" style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => open(f)} title={f.name}>{f.name}</button>
              <span className="faint mono" style={{ fontSize: 12.5 }}>{size(f.size)}</span>
              <button className="btn ghost sm" onClick={() => open(f)} title={t("preview", lang)}><Icon n="eye" /></button>
              <button className="btn ghost sm" onClick={() => dl(f)} title={t("download", lang)}><Icon n="download" /></button>
              <button className="btn ghost sm" onClick={() => share(f)} title={t("share_link", lang)}><Icon n="link" /></button>
              <button className="btn ghost sm" onClick={() => mail([f])} title={t("email_btn", lang)}><Icon n="mail" /></button>
              {canWrite && <button className="btn ghost sm danger" onClick={() => del(f)} title={t("delete", lang)}><Icon n="trash" /></button>}
            </div>))}
          {canWrite && <div className={`dropzone ${over ? "on" : ""}`} role="button" tabIndex={0}
            onClick={() => input.current?.click()} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
            <Icon n="upload" className="lockico" /> {busy ? t("uploading", lang) : t("drop_files", lang)}
            <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </div>}
        </div>
      )}
      {view && <Viewer file={view.f} url={view.url} onClose={() => setView(null)} />}
    </div>
  );
}
