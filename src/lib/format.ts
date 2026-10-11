import { Lang, tx } from "./i18n";
import type { Rec } from "./store";

const GOOD = /^(done|granted|awarded|implemented|pass|actual|taken|issued|returned|settled|exceeds|meets|analyzed|passed|approved|cleared|installed|commissioned|won|paid|signed|active|released|published|registered|received|resolved|certified|delivered|live|hired|counsel approved|integrated|filed|closed|verified)/i;
const BAD = /^(failed|fail$|denied|litigation|lost|below|non-conformance|blocked|rejected|lost|overdue|flagged|restricted|prohibited|refused|critical|over budget|expired|cancelled)/i;
const WARN = /^(pending|requested|assessing|non-conformance|corrective|maintenance due|warranty claim|escalated|findings open|preparing|shortlisted|quote|self-review|manager review|in review|under review|negotiation|renewal due|waiting|customs|high|due|mitigating|investigating|onboarding)/i;
export function tone(v?: string | null) {
  if (!v) return "";
  if (BAD.test(v)) return "c-bad";
  if (GOOD.test(v)) return "c-ok";
  if (WARN.test(v)) return "c-warn";
  if (/^(medium|in progress|running|integration|testing|assembly|proposal|qualified|ordered|in transit|sent|submitted)/i.test(v)) return "c-info";
  return "";
}

export function fmt(field: any, v: any, lang: Lang): string {
  if (v === undefined || v === null || v === "") return "";
  if (field?.type === "money" || field?.type === "number") {
    const n = Number(v); if (Number.isNaN(n)) return String(v);
    return n.toLocaleString(lang === "ar" ? "ar-AE" : lang === "ru" ? "ru-RU" : lang === "uk" ? "uk-UA" : "en-US");
  }
  if (field?.type === "check") return v ? "✓" : "";
  if (field?.type === "checklist") { const n = typeof v === "object" ? Object.values(v).filter(Boolean).length : 0; return `${n} ✓`; }
  if (field?.type === "date") { try { return new Date(v).toLocaleDateString(lang === "ar" ? "ar-AE" : lang); } catch { return String(v); } }
  return String(v);
}

export function recordMarkdown(section: any, r: Rec, lang: Lang) {
  const rows = section.fields.filter((f: any) => f.type !== "html" && r.data?.[f.key] !== undefined && r.data?.[f.key] !== "").map((f: any) => `| ${tx(f.label, lang)} | ${fmt(f, r.data[f.key], lang).replace(/\|/g, "/").replace(/\n/g, " ")} |`);
  return `# ${r.title}\n\n**${tx(section.label, lang)}** · ${r.status || ""}${r.controlled ? " · CONTROLLED (US persons only)" : ""}\n\n| | |\n|---|---|\n${rows.join("\n")}\n\n---\n_AGRON Workspace · ${new Date().toISOString().slice(0, 10)} · © 2026 AGRON Inc. · Confidential_\n`;
}

export function toCsv(section: any, rows: Rec[], lang: Lang) {
  const fields = section.fields.filter((f: any) => f.type !== "html");
  const head = ["Title", "Status", ...fields.map((f: any) => tx(f.label, lang)), "Updated"];
  const body = rows.map((r) => [r.title, r.status || "", ...fields.map((f: any) => r.data?.[f.key] ?? ""), r.updated_at || ""]);
  return "﻿" + [head, ...body].map((row) => row.map((v) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n");
}

export function saveBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "agron";

/** Renders an element to a branded A4 PDF (works for every script, including Arabic and Cyrillic). */
export async function elementToPdf(el: HTMLElement, filename: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const ratio = canvas.width / pw, pageH = Math.floor(ph * ratio);
  for (let y = 0, first = true; y < canvas.height; y += pageH, first = false) {
    const h = Math.min(pageH, canvas.height - y);
    const c = document.createElement("canvas"); c.width = canvas.width; c.height = h;
    const cx = c.getContext("2d")!; cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, h); cx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (!first) pdf.addPage();
    pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, h / ratio);
  }
  pdf.save(filename);
}

/** Opens a clean print window with the document only. */
export function printHtml(title: string, html: string) {
  const w = window.open("", "_blank", "noopener,width=900,height=1100"); if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "")}</title><style>body{font:15px/1.6 'IBM Plex Sans',Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px}h1{font-size:24px;margin:0 0 12px}h2{font-size:17px;margin:22px 0 6px}table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}hr{border:0;border-top:1px solid #ddd;margin:24px 0}.brand{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd;padding-bottom:12px;margin-bottom:24px;font-size:12px;color:#555}</style></head><body><div class="brand"><b style="font-size:16px;color:#111">AGRON Inc.</b><span>agron1.com · info@agron1.com</span></div>${html}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

