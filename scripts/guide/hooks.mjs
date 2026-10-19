// Lets Node load the app's TypeScript sources: "@/..." aliases and imports without a file extension.
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src") + "/";
export async function resolve(spec, ctx, next) {
  let s = spec;
  if (s.startsWith("@/")) s = pathToFileURL(SRC + s.slice(2)).href;
  else if ((s.startsWith("./") || s.startsWith("../")) && ctx.parentURL?.startsWith("file:")) s = new URL(s, ctx.parentURL).href;
  if (s.startsWith("file:")) { const p = fileURLToPath(s); if (!existsSync(p) || !path.extname(p)) for (const e of [".ts", ".tsx", ".mjs", ".js"]) if (existsSync(p + e)) return next(pathToFileURL(p + e).href, ctx); return next(s, ctx); }
  return next(spec, ctx);
}
