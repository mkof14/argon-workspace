import fs from "node:fs/promises";
import path from "node:path";
import { currentProfile } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANGS = ["en", "ru", "uk", "ar"];
const DIR = path.join(process.cwd(), "guide");

/**
 * The user guide PDFs (built by scripts/guide, one per language) — for signed-in staff only.
 * GET ?manifest=1 → versions, pages and sizes;  GET ?lang=ru[&dl=1] → the PDF (inline, or as a download).
 */
export async function GET(req: Request) {
  const me = await currentProfile();
  if (!me || me.role === "pending") return new Response("Not signed in", { status: 401 });
  if (["partner", "vendor", "investor"].includes(me.role)) return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  if (u.searchParams.get("manifest")) {
    const m = await fs.readFile(path.join(DIR, "manifest.json"), "utf8").catch(() => "{}");
    return new Response(m, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  const lang = LANGS.includes(u.searchParams.get("lang") || "") ? u.searchParams.get("lang")! : "en";
  const file = `AGRON-Workspace-Guide-${lang}.pdf`;
  const buf = await fs.readFile(path.join(DIR, file)).catch(() => null);
  if (!buf) return new Response("Guide not built yet", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${u.searchParams.get("dl") ? "attachment" : "inline"}; filename="${file}"`, "Cache-Control": "private, max-age=300" } });
}
