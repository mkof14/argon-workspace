// Real (vector, selectable) PDF documents from Markdown: headings, paragraphs with bold/italic,
// lists, check boxes, tables, rules, page header and numbered footer. IBM Plex Sans covers Latin and Cyrillic.
import type { jsPDF as JsPDF } from "jspdf";

type Run = { t: string; b?: boolean; i?: boolean };
const PAGE = { w: 595.28, h: 841.89, ml: 62, mr: 62, mt: 78, mb: 70 };
const INK: [number, number, number] = [17, 24, 32], MUTED: [number, number, number] = [110, 122, 135], LINE: [number, number, number] = [210, 217, 225];
let fontCache: Record<string, string> | null = null;

async function loadFonts(doc: JsPDF) {
  if (!fontCache) {
    const get = async (f: string) => { const b = new Uint8Array(await (await fetch(`/fonts/${f}`)).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
    const [r, b, i] = await Promise.all([get("IBMPlexSans_400Regular.ttf"), get("IBMPlexSans_600SemiBold.ttf"), get("IBMPlexSans_400Regular_Italic.ttf")]);
    fontCache = { r, b, i };
  }
  doc.addFileToVFS("Plex-R.ttf", fontCache.r); doc.addFont("Plex-R.ttf", "Plex", "normal");
  doc.addFileToVFS("Plex-B.ttf", fontCache.b); doc.addFont("Plex-B.ttf", "Plex", "bold");
  doc.addFileToVFS("Plex-I.ttf", fontCache.i); doc.addFont("Plex-I.ttf", "Plex", "italic");
}

/** Inline Markdown → runs with bold / italic flags; line breaks become "\n" runs. */
function inline(tokens: any[] | undefined, raw = "", b = false, i = false): Run[] {
  if (!tokens) return [{ t: raw, b, i }];
  const out: Run[] = [];
  for (const tk of tokens) {
    if (tk.type === "strong") out.push(...inline(tk.tokens, tk.text, true, i));
    else if (tk.type === "em") out.push(...inline(tk.tokens, tk.text, b, true));
    else if (tk.type === "br") out.push({ t: "\n" });
    else if (tk.type === "link") out.push(...inline(tk.tokens, tk.text, b, i));
    else if (tk.type === "codespan") out.push({ t: tk.text, b, i });
    else if (tk.type === "html") out.push({ t: tk.text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""), b, i });
    else if (tk.type === "text" && tk.tokens) out.push(...inline(tk.tokens, tk.text, b, i));
    else out.push({ t: decode(tk.text ?? tk.raw ?? ""), b, i });
  }
  return out;
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const plain = (runs: Run[]) => runs.map((r) => r.t).join("");

export async function markdownToPdf(md: string, opts: { title: string; filename: string; subtitle?: string; confidential?: boolean; blob?: boolean; /** Photos added after the text (data URLs, JPEG or PNG) */ images?: { title: string; data: string }[] }): Promise<Blob | void> {
  const [{ jsPDF }, { marked }, { autoTable }] = await Promise.all([import("jspdf"), import("marked"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  await loadFonts(doc);
  doc.setProperties({ title: opts.title, author: "AGRON Inc.", creator: "AGRON Workspace" });
  const W = PAGE.w - PAGE.ml - PAGE.mr;
  let y = PAGE.mt;
  const font = (b?: boolean, i?: boolean) => doc.setFont("Plex", b ? "bold" : i ? "italic" : "normal");
  const ensure = (h: number) => { if (y + h > PAGE.h - PAGE.mb) { doc.addPage(); y = PAGE.mt; } };

  /** Writes runs with word wrap; returns nothing, advances y. */
  const write = (runs: Run[], size: number, lh: number, x0 = PAGE.ml, width = W, color = INK) => {
    doc.setFontSize(size); doc.setTextColor(...color);
    // split into words keeping style
    const words: { t: string; b?: boolean; i?: boolean; nl?: boolean }[] = [];
    for (const r of runs) {
      const parts = r.t.replace(/☐/g, "☐").split(/(\n|\s+)/);
      for (const p of parts) { if (p === "") continue; if (p === "\n") words.push({ t: "", nl: true }); else words.push({ t: /^\s+$/.test(p) ? " " : p, b: r.b, i: r.i }); }
    }
    let line: typeof words = []; let lw = 0;
    const flush = () => {
      ensure(lh); let x = x0;
      while (line.length && line[line.length - 1].t === " ") line.pop();
      for (const w of line) {
        font(w.b, w.i);
        if (w.t === "☐") { doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.rect(x, y - size * 0.72, size * 0.72, size * 0.72); x += size * 0.95; continue; }
        doc.text(w.t, x, y); x += doc.getTextWidth(w.t);
      }
      y += lh; line = []; lw = 0;
    };
    for (const w of words) {
      if (w.nl) { flush(); continue; }
      if (w.t === " " && !line.length) continue;
      font(w.b, w.i);
      const ww = w.t === "☐" ? size * 0.95 : doc.getTextWidth(w.t);
      if (lw + ww > width && line.length && w.t !== " ") {
        // very long single word: hard split
        flush();
      }
      if (ww > width) { // break a long token (e.g. underscores) to fit
        let s = w.t; while (s) { let k = s.length; while (k > 1 && doc.getTextWidth(s.slice(0, k)) > width) k--; line.push({ ...w, t: s.slice(0, k) }); flush(); s = s.slice(k); }
        continue;
      }
      line.push(w); lw += ww;
    }
    if (line.length) flush();
  };

  // Header band (first page): wordmark, title, subtitle
  font(true); doc.setFontSize(11); doc.setTextColor(194, 65, 12); doc.text("AGRON", PAGE.ml, 46);
  font(); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text("AGRON Inc. · agron1.com · info@agron1.com", PAGE.w - PAGE.mr, 46, { align: "right" });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(PAGE.ml, 54, PAGE.w - PAGE.mr, 54);
  if (opts.subtitle) { write([{ t: opts.subtitle }], 9.5, 13, PAGE.ml, W, MUTED); y += 4; }

  const tokens = marked.lexer(md);
  const block = (tk: any, indent = 0) => {
    const x = PAGE.ml + indent, w = W - indent;
    switch (tk.type) {
      case "heading": {
        const size = tk.depth === 1 ? 17 : tk.depth === 2 ? 12.5 : 11;
        y += tk.depth === 1 ? 6 : 10; ensure(size * 2.4);
        write(inline(tk.tokens, tk.text, true), size, size * 1.32, x, w);
        y += tk.depth === 1 ? 6 : 3; break;
      }
      case "paragraph": write(inline(tk.tokens, tk.text), 10.2, 14.6, x, w); y += 6; break;
      case "text": write(inline(tk.tokens, tk.text), 10.2, 14.6, x, w); break;
      case "space": y += 4; break;
      case "hr": ensure(14); y += 4; doc.setDrawColor(...LINE); doc.line(PAGE.ml, y, PAGE.w - PAGE.mr, y); y += 12; break;
      case "blockquote": for (const t of tk.tokens) block(t, indent + 14); break;
      case "list": {
        tk.items.forEach((it: any, n: number) => {
          const mark = tk.ordered ? `${(tk.start || 1) + n}.` : it.task ? "" : "•";
          ensure(15); font(); doc.setFontSize(10.2); doc.setTextColor(...INK);
          if (it.task) { doc.setDrawColor(...INK); doc.rect(x + 2, y - 8, 8, 8); if (it.checked) doc.text("✓", x + 3, y - 0.5); }
          else doc.text(mark, x + 2, y);
          const startY = y;
          it.tokens.forEach((t: any) => { if (t.type === "text" || t.type === "paragraph") { write(inline(t.tokens, t.text), 10.2, 14.6, x + 18, w - 18); } else block(t, indent + 18); });
          if (y === startY) y += 14.6;
          y += 2;
        });
        y += 4; break;
      }
      case "table": {
        const head = [tk.header.map((c: any) => plain(inline(c.tokens, c.text)))];
        const body = tk.rows.map((r: any[]) => r.map((c: any) => plain(inline(c.tokens, c.text))));
        const empty = head[0].every((h: string) => !h.trim());
        autoTable(doc, {
          startY: y - 4, margin: { left: x, right: PAGE.mr, top: PAGE.mt, bottom: PAGE.mb }, head: empty ? undefined : head, body,
          styles: { font: "Plex", fontSize: 9.4, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: "linebreak", valign: "top" },
          headStyles: { font: "Plex", fontStyle: "bold", fillColor: [245, 247, 249], textColor: INK },
          columnStyles: empty && body[0]?.length === 2 ? { 0: { fontStyle: "bold", cellWidth: 150 } } : {},
          theme: "grid",
        });
        y = (doc as any).lastAutoTable.finalY + 14; break;
      }
      case "html": write([{ t: tk.text.replace(/<[^>]+>/g, "") }], 10.2, 14.6, x, w); break;
      case "code": write([{ t: tk.text }], 9.5, 13.5, x, w); y += 6; break;
      default: if (tk.text) write([{ t: tk.text }], 10.2, 14.6, x, w);
    }
  };
  for (const tk of tokens) block(tk);

  // Photos: each fitted to the page width (never enlarged more than 1.5×), with its caption
  for (const im of opts.images || []) {
    try {
      const p = doc.getImageProperties(im.data); const maxH = PAGE.h - PAGE.mt - PAGE.mb - 40;
      const r = Math.min(W / p.width, maxH / p.height, 1.5); const w = p.width * r, h = p.height * r;
      ensure(h + 30); font(true); doc.setFontSize(9.5); doc.setTextColor(...MUTED); doc.text(im.title.slice(0, 110), PAGE.ml, y); y += 10;
      doc.addImage(im.data, /^data:image\/png/i.test(im.data) ? "PNG" : "JPEG", PAGE.ml, y, w, h); y += h + 20;
    } catch { /* a broken image is skipped */ }
  }

  // Running header (pages 2+) and footer with page numbers
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); font(); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    if (p > 1) { doc.text(opts.title, PAGE.ml, 46); doc.text("AGRON Inc.", PAGE.w - PAGE.mr, 46, { align: "right" }); doc.setDrawColor(...LINE); doc.line(PAGE.ml, 54, PAGE.w - PAGE.mr, 54); }
    doc.line(PAGE.ml, PAGE.h - 46, PAGE.w - PAGE.mr, PAGE.h - 46);
    doc.text(opts.confidential === false ? "AGRON Inc." : "AGRON Inc. · Confidential", PAGE.ml, PAGE.h - 32);
    doc.text(`Page ${p} of ${n}`, PAGE.w - PAGE.mr, PAGE.h - 32, { align: "right" });
  }
  if (opts.blob) return doc.output("blob");
  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}
