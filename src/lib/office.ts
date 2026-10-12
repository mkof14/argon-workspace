/**
 * Plain text from Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) files, in the browser, without libraries.
 * These formats are ZIP archives of XML; we read the archive directory and inflate the parts we need.
 */
type Entry = { name: string; method: number; size: number; offset: number };

function entries(buf: Uint8Array): Entry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a valid Office file");
  const count = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
  const out: Entry[] = []; const dec = new TextDecoder();
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), offset = v.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, size, offset });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function read(buf: Uint8Array, e: Entry): Promise<string> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const data = buf.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error("Unsupported compression");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const num = (s: string) => Number((s.match(/(\d+)/) || [])[1] || 0);

export async function officeText(file: Blob, name: string, limit = 120_000): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const all = entries(buf);
  const get = (n: string) => all.find((e) => e.name === n);
  const ext = (name.split(".").pop() || "").toLowerCase();
  let out = "";
  if (ext === "docx") {
    const doc = get("word/document.xml"); if (!doc) throw new Error("Word document body not found");
    const xml = await read(buf, doc);
    out = xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<[^>]+>/g, "");
  } else if (ext === "xlsx") {
    const ss = get("xl/sharedStrings.xml");
    const shared = ss ? [...(await read(buf, ss)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1].replace(/<[^>]+>/g, ""))) : [];
    const sheets = all.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => num(a.name) - num(b.name));
    for (const s of sheets) {
      const xml = await read(buf, s); out += `# Sheet ${num(s.name)}\n`;
      for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [...row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
          const attrs = c[1], body = c[2] || ""; const val = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (/t="s"/.test(attrs) && val != null) return shared[+val] ?? "";
          if (/t="inlineStr"/.test(attrs)) return unxml(body.replace(/<[^>]+>/g, ""));
          return val != null ? unxml(val) : "";
        });
        if (cells.some((x) => x !== "")) out += cells.join("\t") + "\n";
        if (out.length > limit) break;
      }
    }
    return out.slice(0, limit);
  } else if (ext === "pptx") {
    const slides = all.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => num(a.name) - num(b.name));
    for (const s of slides) out += `# Slide ${num(s.name)}\n` + [...(await read(buf, s)).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join(" ") + "\n";
  } else throw new Error("Unsupported Office format");
  return unxml(out).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}

export const isOffice = (name: string) => /\.(docx|xlsx|pptx)$/i.test(name);
