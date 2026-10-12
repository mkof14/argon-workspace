import { extractText, getDocumentProxy } from "unpdf";
import { officeText } from "@/lib/office";
import { chunk } from "@/lib/docsText";
export { tsQuery } from "@/lib/docsText";

/** Turns an attached file into page texts for "Ask your documents". Images and unknown formats are skipped. */
export async function filePages(buf: Uint8Array, name: string): Promise<string[] | null> {
  if (/\.pdf$/i.test(name)) {
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: false });
    return (text as string[]).map((t) => t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  }
  if (/\.(docx|xlsx|pptx)$/i.test(name)) return chunk(await officeText(new Blob([buf as BlobPart]), name, 400_000));
  if (/\.(txt|md|csv)$/i.test(name)) return chunk(new TextDecoder().decode(buf).slice(0, 400_000));
  return null;
}

/** Indexes one stored file (service role). A file without text gets one empty page so it is not retried forever. */
export async function indexFile(admin: any, path: string): Promise<number> {
  const recordId = path.split("/")[1];
  const name = (path.split("/").pop() || "file").replace(/^\d+_/, "");
  const { data: blob, error } = await admin.storage.from("files").download(path);
  if (error || !blob) throw new Error(error?.message || "File not found");
  let pages: string[] | null = null;
  try { pages = await filePages(new Uint8Array(await blob.arrayBuffer()), name); } catch { pages = null; }
  const rows = (pages && pages.some((p) => p.trim()) ? pages : [""]).map((content, i) => ({ record_id: recordId, path, file_name: name, page: i + 1, content: content.slice(0, 20000) }));
  await admin.from("doc_pages").delete().eq("path", path);
  for (let i = 0; i < rows.length; i += 200) { const { error: e } = await admin.from("doc_pages").insert(rows.slice(i, i + 200)); if (e) throw new Error(e.message); }
  return rows.filter((r) => r.content).length;
}

