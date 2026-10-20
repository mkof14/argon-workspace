import { adminClient, currentProfile, userClient } from "@/lib/server/supabase";
import { clientIp, limit } from "@/lib/server/authz";
import { openFile, registerVersion, uploadVersion, verifyVersion } from "@/lib/server/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Document versions.
 *  register {record_id, path, label?, major?, note?} → the uploaded file becomes the next version (hash computed here)
 *  open     {version_id | path, mode: download|preview} → a 2-minute link, after the person's own access check; logged
 *  verify   {version_id} → recompute the stored file's hash and compare
 *  (multipart) upload {record_id, file, label?, major?, note?} → stored by the server and registered as the next version
 */
export async function POST(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  const admin = adminClient();
  { const lim = await limit(`docs:${me.id}`, 120, 60, admin); if (lim) return lim; }
  const c = { user: await userClient(), admin, me, ip: clientIp(req), ua: req.headers.get("user-agent") || "" };
  if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) { // upload {record_id, file, label?, major?, note?}
    const f = await req.formData(); const file = f.get("file") as File | null;
    if (!file) return new Response("No file", { status: 400 });
    const out: any = await uploadVersion(c, { record_id: String(f.get("record_id") || ""), name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
      label: String(f.get("label") || "") || undefined, major: f.get("major") === "true", note: String(f.get("note") || "") || undefined });
    if (out.error) return new Response(out.error, { status: out.status || 400 });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  }
  const b = await req.json().catch(() => ({}));
  const out: any = b.action === "register" ? await registerVersion(c, b)
    : b.action === "open" ? await openFile(c, b)
    : b.action === "verify" ? await verifyVersion(c, String(b.version_id || ""))
    : { error: "Unknown action", status: 400 };
  if (out.error) return new Response(out.error, { status: out.status || 400 });
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
