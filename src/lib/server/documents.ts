// Document versions on the server: registering a stored file as a version (the server computes its SHA-256),
// audited downloads (allowed and refused attempts, never the content) and integrity checks.
// Every step first reads through the person's own database client, so the same rules as browsing apply;
// the service client is used only after that check, to hash files and to hand out a short-lived link.
import { createHash } from "node:crypto";
import { indexFile } from "./docs";

export type Who = { id: string };
export type Ctx = { user: any; admin: any; me: Who; ip?: string; ua?: string };

const sha256 = async (blob: Blob) => createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
const recordOf = (path: string) => { const [section, id] = path.split("/"); return /^[0-9a-f-]{36}$/.test(id || "") ? { section, id } : null; };

async function log(c: Ctx, e: { record_id?: string | null; version_id?: string | null; path?: string | null; action: "download" | "preview" | "verify"; ok: boolean; reason?: string }) {
  await c.admin.from("document_access_log").insert({ user_id: c.me.id, record_id: e.record_id || null, version_id: e.version_id || null, path: e.path ? String(e.path).slice(0, 500) : null,
    action: e.action, ok: e.ok, reason: e.reason ? e.reason.slice(0, 300) : null, ip: c.ip ? c.ip.slice(0, 80) : null, user_agent: c.ua ? c.ua.slice(0, 300) : null });
}

/** A file already uploaded to the document's folder becomes its next version. */
export async function registerVersion(c: Ctx, a: { record_id: string; path: string; label?: string; major?: boolean; note?: string }) {
  const { data: rec } = await c.user.from("records").select("id,section").eq("id", a.record_id).maybeSingle();
  if (!rec || rec.section !== "company.documents") return { error: "Document not found", status: 404 };
  const { data: obj, error } = await c.admin.storage.from("files").download(a.path);
  if (error || !obj) return { error: "File not found", status: 404 };
  const hash = await sha256(obj);
  const { data, error: e2 } = await c.admin.rpc("document_version_add", { p_actor: c.me.id, p_record: rec.id, p_path: a.path, p_sha256: hash, p_size: obj.size, p_mime: obj.type || null,
    p_label: a.label || null, p_major: !!a.major, p_note: a.note || null });
  if (e2) return { error: e2.message, status: e2.code === "42501" ? 403 : 400 };
  try { await indexFile(c.admin, a.path); } catch {} // text of the version for search and the Assistant
  return { version: data };
}

/** Upload through the server: the file goes into the document's folder with the service role (the person's own
 *  access is checked first), then becomes the next version. Used for every document, and the only way for controlled
 *  or restricted ones, whose files are not readable straight from Storage. */
export async function uploadVersion(c: Ctx, a: { record_id: string; name: string; bytes: Uint8Array; type?: string; label?: string; major?: boolean; note?: string }) {
  if (!a.bytes?.length) return { error: "Empty file", status: 400 };
  if (a.bytes.length > 50 * 1024 * 1024) return { error: "The file is larger than 50 MB", status: 413 };
  const { data: rec } = await c.user.from("records").select("id,section").eq("id", a.record_id).maybeSingle();
  if (!rec || rec.section !== "company.documents") return { error: "Document not found", status: 404 };
  const { data: can } = await c.user.rpc("can_write", { sec: "company.documents" });
  if (!can) return { error: "No right to add a version to this document", status: 403 };
  const safe = String(a.name || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-120) || "file";
  const path = `company.documents/${rec.id}/${Date.now()}_${safe}`;
  const { error } = await c.admin.storage.from("files").upload(path, new Blob([a.bytes as BlobPart], { type: a.type || "application/octet-stream" }), { contentType: a.type || "application/octet-stream", upsert: false });
  if (error) return { error: error.message, status: 400 };
  const out = await registerVersion(c, { record_id: rec.id, path, label: a.label, major: a.major, note: a.note });
  if ((out as any).error) await c.admin.storage.from("files").remove([path]); // nothing half-registered stays behind
  return out;
}

/** A short-lived link to one stored file, after the person's own access is checked; every attempt is logged. */
export async function openFile(c: Ctx, a: { version_id?: string; path?: string; mode?: "download" | "preview" }) {
  const action = a.mode === "preview" ? "preview" : "download";
  let path = a.path || null; let version: any = null; let recordId: string | null = null;
  if (a.version_id) {
    const { data } = await c.user.from("document_versions").select("id,record_id,path,file_name,label").eq("id", a.version_id).maybeSingle();
    if (!data) { const { data: hidden } = await c.admin.from("document_versions").select("record_id").eq("id", /^[0-9a-f-]{36}$/.test(a.version_id) ? a.version_id : "00000000-0000-0000-0000-000000000000").maybeSingle();
      await log(c, { record_id: hidden?.record_id || null, version_id: hidden ? a.version_id : null, action, ok: false, reason: "not allowed or not found" }); return { error: "Not found", status: 404 }; }
    version = data; path = data.path; recordId = data.record_id;
  }
  const ref = path ? recordOf(path) : null;
  if (!path || !ref || /\.\./.test(path)) { await log(c, { path, action, ok: false, reason: "bad path" }); return { error: "Not found", status: 404 }; }
  recordId = recordId || ref.id;
  const { data: rec } = await c.user.from("records").select("id,section").eq("id", ref.id).eq("section", ref.section).maybeSingle();
  if (!rec) { await log(c, { record_id: ref.id, version_id: version?.id || null, path: null, action, ok: false, reason: "not allowed or not found" }); return { error: "Not found", status: 404 }; }
  if (!version && rec.section === "company.documents") {
    const { data } = await c.admin.from("document_versions").select("id,label,file_name").eq("path", path).maybeSingle(); version = data;
  }
  const name = version?.file_name || path.split("/").pop()!.replace(/^\d+_/, "");
  const { data: signed, error } = await c.admin.storage.from("files").createSignedUrl(path, 120, action === "download" ? { download: name } : undefined);
  if (error || !signed) { await log(c, { record_id: recordId, version_id: version?.id, path, action, ok: false, reason: "file missing" }); return { error: "File not found", status: 404 }; }
  if (rec.section === "company.documents") await log(c, { record_id: recordId, version_id: version?.id, path, action, ok: true });
  return { url: signed.signedUrl, name, version: version?.label || null };
}

/** Recomputes the hash of a stored version and records whether it still matches. */
export async function verifyVersion(c: Ctx, versionId: string) {
  const { data: v } = await c.user.from("document_versions").select("id,record_id,path,sha256,label").eq("id", versionId).maybeSingle();
  if (!v) { await log(c, { version_id: /^[0-9a-f-]{36}$/.test(versionId) ? versionId : null, action: "verify", ok: false, reason: "not allowed or not found" }); return { error: "Not found", status: 404 }; }
  const { data: obj } = await c.admin.storage.from("files").download(v.path);
  const found = obj ? await sha256(obj) : "missing";
  const ok = found === v.sha256;
  await c.admin.rpc("document_version_verified", { p_actor: c.me.id, p_version: v.id, p_ok: ok, p_found: found });
  await log(c, { record_id: v.record_id, version_id: v.id, path: v.path, action: "verify", ok: true, reason: ok ? "hash matches" : "HASH MISMATCH" });
  return { ok, expected: v.sha256, found, label: v.label };
}
