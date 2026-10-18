"use client";
import { useState } from "react";
import Icon from "./Icon";
import { useApp } from "./App";
import { tx, type Lang } from "@/lib/i18n";
import { store, type Rec } from "@/lib/store";
import { projectPack, type PackLang } from "@/lib/projectpack";

type T4 = { en: string; ru: string; uk: string; ar: string };
const L = (en: string, ru: string, uk: string, ar: string): T4 => ({ en, ru, uk, ar });
const SECS = ["sales.proposals", "legal.contracts", "security.screening", "operations.builds", "operations.procurement", "operations.quality", "operations.logistics", "operations.installation", "finance.invoices", "company.tasks"];
const MAX_PHOTOS = 10;

const toData = (url: string) => fetch(url).then((r) => r.blob()).then((b) => b.size > 3_000_000 ? "" : new Promise<string>((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => ok(""); f.readAsDataURL(b); })).catch(() => "");

/** One PDF with everything about the project: proposal, contracts, checks, plan, payments, acceptance, files and photos. */
export default function ProjectPack({ deal }: { deal: Rec }) {
  const { lang, access, toast } = useApp(); const T = (x: T4) => tx(x, lang as Lang);
  const [busy, setBusy] = useState(false); const [keep, setKeep] = useState(access.write.has("sales.pipeline"));
  const plang: PackLang = lang === "ru" || lang === "uk" ? lang : "en";
  const make = async () => {
    setBusy(true);
    try {
      const recs = (await store.listMany(SECS.filter((s) => access.read.has(s)))).map((r) => ({ ...store.original(r), controlled: r.controlled }) as Rec);
      const d = { ...store.original(deal), controlled: deal.controlled } as Rec; const today = new Date().toISOString().slice(0, 10);
      const first = projectPack({ deal: d, recs, files: {}, lang: plang, today });
      const files: Record<string, string[]> = {}; const imgs: { title: string; path: string }[] = [];
      for (const r of first.records.slice(0, 60)) {
        const fs = await store.files(`${r.section}/${r.id}`).catch(() => []);
        files[r.id] = fs.map((f) => f.name);
        if (first.photoRecords.includes(r.id)) for (const f of fs) if (/^image\/(jpe?g|png)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name)) imgs.push({ title: `${r.title} — ${f.name}`, path: f.path });
      }
      const images = (await Promise.all(imgs.slice(0, MAX_PHOTOS).map(async (i) => ({ title: i.title, data: await toData(await store.fileUrl(i.path, 600).catch(() => "")) })))).filter((i) => i.data);
      const pack = projectPack({ deal: d, recs, files, lang: plang, today, photos: images.length });
      const { markdownToPdf } = await import("@/lib/pdf");
      const name = `AGRON-project-pack-${(d.data?.client || d.title).replace(/[^\w]+/g, "-").slice(0, 40)}-${today}`;
      const blob = await markdownToPdf(pack.md, { title: `${T(L("Project pack", "Пакет проекта", "Пакет проєкту", "ملف المشروع"))} — ${d.title}`, filename: name, images, blob: true, confidential: true });
      if (!blob) throw new Error("PDF");
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      if (keep) await store.upload(`sales.pipeline/${deal.id}`, new File([blob], `${name}.pdf`, { type: "application/pdf" })).catch(() => {});
      toast(`${T(L("Project pack ready", "Пакет проекта готов", "Пакет проєкту готовий", "ملف المشروع جاهز"))}: ${pack.records.length} · ${images.length} ${T(L("photos", "фото", "фото", "صور"))}`);
    } catch (e: any) { toast(e.message || "Error", true); } finally { setBusy(false); }
  };
  return <div className="toolbar">
    <button className="btn sm" disabled={busy} onClick={make}><Icon n="pdf" />{busy ? "…" : T(L("Project pack (PDF)", "Пакет проекта (PDF)", "Пакет проєкту (PDF)", "ملف المشروع (PDF)"))}</button>
    {access.write.has("sales.pipeline") && <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />{T(L("also keep in the deal's files", "сохранить и в файлах сделки", "зберегти й у файлах угоди", "واحفظه في ملفات الصفقة"))}</label>}
    {lang === "ar" && <small className="faint">PDF: English</small>}
  </div>;
}
